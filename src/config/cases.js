export const casesConfig = {
  cases: {
    creationDeadlineMs: {
      doc: 'How long a submission may wait for its creator file to create the CRM case before another file may take over.',
      format: Number,
      default: 60000,
      env: 'CASE_CREATION_DEADLINE_MS'
    }
  }
}
