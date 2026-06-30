import Joi from 'joi'

const CASE_TYPE_MAX_LENGTH = 200

export const createCasePayloadSchema = Joi.object({
  caseType: Joi.string().max(CASE_TYPE_MAX_LENGTH).required(),
  crn: Joi.string().required(),
  sbi: Joi.string().required(),
  caseData: Joi.object({
    title: Joi.string().required(),
    caseDescription: Joi.string().required()
  }).required(),
  onlineSubmissionActivity: Joi.object({
    subject: Joi.string().required(),
    description: Joi.string().required(),
    scheduledStart: Joi.string().isoDate().required(),
    scheduledEnd: Joi.string().isoDate().required(),
    stateCode: Joi.number().required(),
    statusCode: Joi.number().required(),
    metadata: Joi.object({
      name: Joi.string().required(),
      documentType: Joi.string().required(),
      blobFileId: Joi.string().required()
    }).required()
  }).required()
}).required()

export const validationOptions = { convert: false, abortEarly: false }

// named exports only
