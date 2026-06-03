import Joi from 'joi'

export const inboundCloudEventSchema = Joi.object({
  id: Joi.string().required(),
  source: Joi.string().required(),
  specversion: Joi.string().required(),
  type: Joi.string().required(),
  datacontenttype: Joi.string().required(),
  time: Joi.string().isoDate().required(),
  data: Joi.object({
    crn: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    sbi: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    crm: Joi.object().optional(),
    file: Joi.object({
      fileId: Joi.string().guid({ version: ['uuidv4'] }).required(),
      fileName: Joi.string().required(),
      contentType: Joi.string().optional(),
      url: Joi.string().uri().required()
    }).required(),
    correlationId: Joi.string().guid({ version: ['uuidv4'] }).required(),
    sourceSystem: Joi.string().required(),
    submissionId: Joi.string().required()
  }).required()
}).required()

export const validationOptions = { convert: false, abortEarly: false }

// named exports only
