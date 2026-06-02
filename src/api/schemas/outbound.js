import Joi from 'joi'

export const receivedEventSchema = Joi.object({
  id: Joi.string().guid({ version: ['uuidv4'] }).required(),
  source: Joi.string().required(),
  specversion: Joi.string().valid('1.0').required(),
  type: Joi.string().valid('uk.gov.fcp.sfd.crm.case.created', 'uk.gov.fcp.sfd.document.uploaded').required(),
  datacontenttype: Joi.string().required(),
  time: Joi.string().isoDate().required(),
  data: Joi.object({
    correlationId: Joi.string().guid({ version: ['uuidv4'] }).required(),
    caseId: Joi.string().guid({ version: ['uuidv4'] }).required(),
    crn: Joi.number().integer().min(1050000000).max(9999999999).required(),
    sbi: Joi.number().integer().min(105000000).max(999999999).required(),
    caseType: Joi.string().valid('case-created', 'document-uploaded').optional(),
    onlineSubmissionActivities: Joi.array().items(Joi.object({
      id: Joi.string().guid({ version: ['uuidv4'] }).required(),
      fileId: Joi.string().guid({ version: ['uuidv4'] }).required(),
      time: Joi.string().isoDate().required()
    }).options({ allowUnknown: false })).optional()
  }).options({ allowUnknown: false }).required()
}).options({ allowUnknown: false }).required()

// named exports only

export const validationOptions = { convert: false, abortEarly: false }
