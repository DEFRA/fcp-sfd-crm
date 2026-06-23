#!/usr/bin/env node
/**
 * Parses an SQS receive-message JSON response from stdin.
 *
 * Usage:
 *   echo "$RESPONSE" | node scripts/lib/parse-sqs-batch.js count
 *   echo "$RESPONSE" | node scripts/lib/parse-sqs-batch.js get <index> <field>
 *
 * Commands:
 *   count                      print number of messages (0 if none)
 *   get <index> <field>        print the value of Messages[index][field]
 *
 * Supported fields: MessageId, ReceiptHandle, Body
 *
 * All output goes to stdout. Exits 0 on success, 1 on error.
 */

import { readFileSync } from 'node:fs'

const [, , command, ...args] = process.argv

let raw
try {
  raw = readFileSync('/dev/stdin', 'utf8')
} catch {
  raw = '{}'
}

let parsed
try {
  parsed = JSON.parse(raw)
} catch {
  parsed = {}
}

const messages = Array.isArray(parsed.Messages) ? parsed.Messages : []

if (command === 'count') {
  process.stdout.write(String(messages.length))
} else if (command === 'get') {
  const index = Number.parseInt(args[0], 10)
  const field = args[1]
  const message = messages[index]
  if (!message) {
    process.stderr.write(`No message at index ${index}\n`)
    process.exit(1)
  }
  const value = message[field]
  if (value === undefined) {
    process.stderr.write(`Field "${field}" not found on message at index ${index}\n`)
    process.exit(1)
  }
  process.stdout.write(value)
} else {
  process.stderr.write(`Unknown command: ${command}\nUsage: parse-sqs-batch.js count | get <index> <field>\n`)
  process.exit(1)
}
