import { AsyncLocalStorage } from 'node:async_hooks'

const asyncLocalStorage = new AsyncLocalStorage()

const runWithCorrelationId = (correlationId, fn) => {
  return asyncLocalStorage.run(correlationId, fn)
}

const getCorrelationId = () => {
  return asyncLocalStorage.getStore()
}

export { runWithCorrelationId, getCorrelationId }
