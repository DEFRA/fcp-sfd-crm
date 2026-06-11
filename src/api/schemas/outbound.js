import Joi from 'joi'

const CRN_MIN = 1_050_000_000
const CRN_MAX = 9_999_999_999
const SBI_MIN = 105_000_000
const SBI_MAX = 999_999_999

export const receivedEventSchema = Joi.object({
  id: Joi.string().guid({ version: ['uuidv4'] }).required(),
  source: Joi.string().required(),
  specversion: Joi.string().valid('1.0').required(),
  type: Joi.string().valid('uk.gov.fcp.sfd.crm.case.created', 'uk.gov.fcp.sfd.document.uploaded').required(),
  datacontenttype: Joi.string().required(),
  time: Joi.string().isoDate().required(),
  data: Joi.object({
    correlationId: Joi.string().guid({ version: ['uuidv4'] }).required(),
    // CRM/Dynamics returns non-v4 GUIDs for caseId
    caseId: Joi.string().guid().required(),
    crn: Joi.number().integer().min(CRN_MIN).max(CRN_MAX).required(),
    sbi: Joi.number().integer().min(SBI_MIN).max(SBI_MAX).required(),
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
