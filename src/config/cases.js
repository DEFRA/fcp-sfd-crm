const MIN_CREATION_DEADLINE_MS = 1000

export const casesConfig = {
  cases: {
    creationDeadlineMs: {
      doc: 'How long a submission may wait for its creator file to create the CRM case before another file may take over.',
      format: (val) => {
        if (!Number.isInteger(val) || val < MIN_CREATION_DEADLINE_MS) {
          throw new Error(`must be an integer >= ${MIN_CREATION_DEADLINE_MS}`)
        }
      },
      default: 60000,
      env: 'CASE_CREATION_DEADLINE_MS'
    }
  }
}
