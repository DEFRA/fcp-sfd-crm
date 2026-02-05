// Ensure .env.test is loaded for all tests
import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ path: '.env.test' })
