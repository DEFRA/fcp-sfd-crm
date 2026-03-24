import { readFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const SONARCLOUD_BASE_URL = 'https://sonarcloud.io'
const BORDER = '═'.repeat(51)
const THIN_BORDER = '─'.repeat(51)
const MAX_ISSUES_DISPLAYED = 30

const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']
const SEVERITY_ICONS = {
  BLOCKER: '🔴',
  CRITICAL: '🟠',
  MAJOR: '🟡',
  MINOR: '🔵',
  INFO: '⚪'
}

const HOTSPOT_ICONS = {
  HIGH: '🔴',
  MEDIUM: '🟠',
  LOW: '🟡'
}

const METRIC_LABELS = {
  new_reliability_rating: 'Reliability Rating',
  new_security_rating: 'Security Rating',
  new_maintainability_rating: 'Maintainability Rating',
  new_coverage: 'Coverage on New Code',
  new_duplicated_lines_density: 'Duplication on New Code',
  new_violations: 'New Issues',
  new_security_hotspots_reviewed: 'Security Hotspots Reviewed',
  new_blocker_violations: 'Blocker Issues',
  new_critical_violations: 'Critical Issues'
}

const COMPARATOR_SYMBOLS = {
  GT: '>',
  LT: '<',
  EQ: '=',
  NE: '≠'
}

const parseDotEnv = async (filePath) => {
  const vars = {}

  try {
    const content = await readFile(filePath, 'utf8')

    for (const line of content.split('\n')) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) continue

      const eqIndex = trimmed.indexOf('=')

      if (eqIndex === -1) continue

      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '')
      vars[key] = value
    }
  } catch {
    // .env file not found or unreadable — continue with process.env only
  }

  return vars
}

const parseSonarProperties = async (filePath) => {
  const props = {}
  const content = await readFile(filePath, 'utf8')

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')

    if (eqIndex === -1) continue

    props[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim()
  }

  return props
}

const getCurrentBranch = () =>
  execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()

const runScanner = (sonarToken, cwd, branch) =>
  new Promise((resolve, reject) => {
    const args = [
      'run',
      '--rm',
      '--name',
      'sonar-scan',
      '-v',
      `${cwd}:/usr/src`,
      '-e',
      `SONAR_TOKEN=${sonarToken}`,
      'sonarsource/sonar-scanner-cli',
      '-Dsonar.issuesReport.console.enable=true',
      '-Dsonar.qualitygate.wait=true',
      `-Dsonar.branch.name=${branch}`,
      '-Dsonar.verbose=true'
    ]

    const child = spawn('docker', args, { stdio: 'inherit' })

    child.on('error', reject)
    // Always resolve with the exit code — a non-zero exit may simply mean the
    // quality gate failed (analysis was still uploaded). We check the gate
    // status via the API after the scan and exit accordingly.
    child.on('close', resolve)
  })

const sonarcloudFetch = async (path, sonarToken) => {
  const url = `${SONARCLOUD_BASE_URL}${path}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${sonarToken}`
    }
  })

  if (!response.ok) {
    throw new Error(`SonarCloud API error ${response.status}: ${response.statusText} (${url})`)
  }

  return response.json()
}

const fetchQualityGate = (projectKey, sonarToken, branch) =>
  sonarcloudFetch(
    `/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}`,
    sonarToken
  )

const fetchMeasures = (projectKey, sonarToken, branch) =>
  sonarcloudFetch(
    `/api/measures/component?component=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}&metricKeys=new_violations,accepted_issues,security_hotspots,new_coverage,new_duplicated_lines_density`,
    sonarToken
  )

const fetchIssues = (projectKey, sonarToken, branch) =>
  sonarcloudFetch(
    `/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}&resolved=false&inNewCodePeriod=true&ps=500&statuses=OPEN,CONFIRMED,REOPENED`,
    sonarToken
  )

const fetchSecurityHotspots = (projectKey, sonarToken, branch) =>
  sonarcloudFetch(
    `/api/hotspots/search?projectKey=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(branch)}&inNewCodePeriod=true&ps=500&status=TO_REVIEW`,
    sonarToken
  )

const getMeasureValue = (measures, key) => {
  const measure = measures.find((m) => m.metric === key)
  if (!measure) return 'N/A'

  return measure.value ?? measure.periods?.[0]?.value ?? 'N/A'
}

const formatPercent = (value) => (value === 'N/A' ? 'N/A' : `${parseFloat(value).toFixed(1)}%`)

const row = (label, value) => ` ${`  ${label}`.padEnd(28)}${value}`

const extractFilePath = (component, projectKey) => {
  const prefix = `${projectKey}:`
  return component.startsWith(prefix) ? component.slice(prefix.length) : component
}

const printFailedConditions = (qualityGate) => {
  const conditions = qualityGate.projectStatus?.conditions ?? []
  const failed = conditions.filter((c) => c.status === 'ERROR')

  if (failed.length === 0) return

  console.log(THIN_BORDER)
  console.log(' ⛔ Failed Conditions')

  for (const condition of failed) {
    const label = METRIC_LABELS[condition.metricKey] ?? condition.metricKey
    const comparator = COMPARATOR_SYMBOLS[condition.comparator] ?? condition.comparator

    const actual = condition.metricKey.includes('coverage') || condition.metricKey.includes('duplicat')
      ? formatPercent(condition.actualValue)
      : condition.actualValue

    const threshold = condition.metricKey.includes('coverage') || condition.metricKey.includes('duplicat')
      ? formatPercent(condition.errorThreshold)
      : condition.errorThreshold

    console.log(`    ${label}: ${actual} (threshold ${comparator} ${threshold})`)
  }
}

const printIssues = (issuesResponse, projectKey) => {
  const issues = issuesResponse?.issues ?? []
  const total = issuesResponse?.total ?? issues.length

  if (issues.length === 0) return

  // Sort by severity
  issues.sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  )

  // Group by file
  const byFile = new Map()

  for (const issue of issues) {
    const filePath = extractFilePath(issue.component, projectKey)
    if (!byFile.has(filePath)) byFile.set(filePath, [])
    byFile.get(filePath).push(issue)
  }

  const issuesUrl = `${SONARCLOUD_BASE_URL}/project/issues?id=${encodeURIComponent(projectKey)}&resolved=false&inNewCodePeriod=true`

  console.log(`\n${BORDER}`)
  console.log(` 🐛 Issues (${total} total)`)
  console.log(BORDER)

  let displayed = 0

  for (const [filePath, fileIssues] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (displayed >= MAX_ISSUES_DISPLAYED) break

    console.log(`\n  📄 ${filePath}`)

    for (const issue of fileIssues) {
      if (displayed >= MAX_ISSUES_DISPLAYED) break

      const icon = SEVERITY_ICONS[issue.severity] ?? '⚪'
      const rule = issue.rule ? ` (${issue.rule})` : ''

      console.log(`    ${icon} L${issue.line ?? '?'} ${issue.message}${rule}`)

      const issueUrl = `${SONARCLOUD_BASE_URL}/project/issues?id=${encodeURIComponent(projectKey)}&open=${encodeURIComponent(issue.key)}`

      console.log(`       ${issueUrl}`)

      displayed++
    }
  }

  if (total > MAX_ISSUES_DISPLAYED) {
    console.log(`\n  ... and ${total - MAX_ISSUES_DISPLAYED} more`)
  }

  console.log(THIN_BORDER)
  console.log(` 🔗 ${issuesUrl}`)
  console.log(`${BORDER}\n`)
}

const printHotspots = (hotspotsResponse, projectKey) => {
  const hotspots = hotspotsResponse?.hotspots ?? []

  if (hotspots.length === 0) return

  const total = hotspotsResponse?.paging?.total ?? hotspots.length

  console.log(`\n${BORDER}`)
  console.log(` 🔥 Security Hotspots (${total} to review)`)
  console.log(BORDER)

  let displayed = 0

  for (const hotspot of hotspots) {
    if (displayed >= MAX_ISSUES_DISPLAYED) break

    const filePath = extractFilePath(hotspot.component, projectKey)
    const icon = HOTSPOT_ICONS[hotspot.vulnerabilityProbability] ?? '🟡'
    const probability = hotspot.vulnerabilityProbability ?? 'UNKNOWN'

    console.log(`\n  📄 ${filePath}`)
    console.log(`    ${icon} [${probability}] L${hotspot.line ?? '?'} ${hotspot.message}`)

    const hotspotUrl = `${SONARCLOUD_BASE_URL}/security_hotspots?id=${encodeURIComponent(projectKey)}&hotspots=${encodeURIComponent(hotspot.key)}`

    console.log(`       ${hotspotUrl}`)

    displayed++
  }

  if (total > MAX_ISSUES_DISPLAYED) {
    console.log(`\n  ... and ${total - MAX_ISSUES_DISPLAYED} more`)
  }

  const hotspotsUrl = `${SONARCLOUD_BASE_URL}/security_hotspots?id=${encodeURIComponent(projectKey)}&inNewCodePeriod=true`

  console.log(THIN_BORDER)
  console.log(` 🔗 ${hotspotsUrl}`)
  console.log(`${BORDER}\n`)
}

const printSummary = (qualityGate, measuresResponse, projectKey, branch) => {
  const measures = measuresResponse.component?.measures ?? []
  const status = qualityGate.projectStatus?.status

  const passed = status === 'OK'
  const statusLabel = passed ? '✅ PASSED' : status === 'WARN' ? '⚠️  WARN' : '❌ FAILED'

  // Issues
  const newIssues = getMeasureValue(measures, 'new_violations')
  const acceptedIssues = getMeasureValue(measures, 'accepted_issues')

  // Measures
  const securityHotspots = getMeasureValue(measures, 'security_hotspots')
  const coverageOnNew = formatPercent(getMeasureValue(measures, 'new_coverage'))
  const duplicationOnNew = formatPercent(getMeasureValue(measures, 'new_duplicated_lines_density'))

  const dashboardUrl = `${SONARCLOUD_BASE_URL}/summary/overall?id=${encodeURIComponent(projectKey)}`

  console.log(`\n${BORDER}`)
  console.log(` SonarCloud Quality Gate: ${statusLabel}`)
  console.log(BORDER)
  console.log(' Issues')
  console.log(row('New Issues:', newIssues))
  console.log(row('Accepted Issues:', acceptedIssues))
  console.log(' Measures')
  console.log(row('Security Hotspots:', securityHotspots))
  console.log(row('Coverage on New Code:', coverageOnNew))
  console.log(row('Duplication on New Code:', duplicationOnNew))

  if (!passed) {
    printFailedConditions(qualityGate)
  }

  console.log(BORDER)
  console.log(` 🔀 Branch: ${branch}`)
  console.log(` 🔗 ${dashboardUrl}`)
  console.log(`${BORDER}\n`)

  return passed || status === 'WARN'
}

const sonarScan = async () => {
  const cwd = resolve('.')

  // Load .env if present (mirrors `source .env` from the old npm script)
  const envPath = resolve(cwd, '.env')
  const envVars = existsSync(envPath) ? await parseDotEnv(envPath) : {}
  const sonarToken = envVars.SONAR_TOKEN ?? process.env.SONAR_TOKEN

  if (!sonarToken) {
    console.error(
      'Error: SONAR_TOKEN is not set. Add it to your .env file.'
    )

    process.exit(1)
  }

  // Read project config from sonar-project.properties
  const propsPath = resolve(cwd, 'sonar-project.properties')
  const props = await parseSonarProperties(propsPath)
  const projectKey = props['sonar.projectKey']

  if (!projectKey) {
    console.error('Error: sonar.projectKey not found in sonar-project.properties')
    process.exit(1)
  }

  // Detect current branch so the scan targets it on SonarCloud
  const branch = getCurrentBranch()
  console.log(`\n🔀 Branch: ${branch}\n`)

  // Run the scanner — resolves with exit code (0 = success, non-zero = quality
  // gate failed or scan error). We always attempt to fetch the summary.
  const scanCode = await runScanner(sonarToken, cwd, branch)

  // Fetch quality gate + metrics and print summary
  let qualityGate, measuresResponse

  try {
    ;[qualityGate, measuresResponse] = await Promise.all([
      fetchQualityGate(projectKey, sonarToken, branch),
      fetchMeasures(projectKey, sonarToken, branch)
    ])
  } catch (apiErr) {
    // API fetch failed — the scan likely didn't upload (e.g. auth error, network)
    if (scanCode !== 0) {
      console.error(`\nSonar scanner exited with code ${scanCode}. No results to display.`)
      process.exit(scanCode)
    }

    throw apiErr
  }

  const passed = printSummary(qualityGate, measuresResponse, projectKey, branch)

  if (!passed) {
    // Fetch detailed issues and hotspots to help developers fix problems locally
    try {
      const measures = measuresResponse.component?.measures ?? []
      const hotspotCount = getMeasureValue(measures, 'security_hotspots')
      const shouldFetchHotspots = hotspotCount !== 'N/A' && parseInt(hotspotCount, 10) > 0

      const fetches = [fetchIssues(projectKey, sonarToken, branch)]

      if (shouldFetchHotspots) {
        fetches.push(fetchSecurityHotspots(projectKey, sonarToken, branch))
      }

      const [issuesResponse, hotspotsResponse] = await Promise.all(fetches)

      printIssues(issuesResponse, projectKey)

      if (hotspotsResponse) {
        printHotspots(hotspotsResponse, projectKey)
      }
    } catch (detailErr) {
      console.error(`\nCould not fetch issue details: ${detailErr.message}`)
    }

    process.exit(1)
  }
}

sonarScan().catch((err) => {
  console.error(`\nSonar scan failed: ${err.message}`)
  process.exit(1)
})
