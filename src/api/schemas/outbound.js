import Joi from 'joi'

export const receivedEventSchema = Joi.object({
    id: Joi.string().required(),
    source: Joi.string().required(),
    specversion: Joi.string().required(),
    type: Joi.string().required(),
    datacontenttype: Joi.string().required(),
    time: Joi.string().isoDate().required(),
    data: Joi.object({
        correlationId: Joi.string().required(),
        caseId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        crn: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        sbi: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        caseType: Joi.string().optional(),
        onlineSubmissionActivities: Joi.array().items(Joi.object({
            id: Joi.string().required(),
            fileId: Joi.string().required(),
            time: Joi.string().isoDate().required()
        })).optional()
    }).required().unknown(true)
}).required().unknown(true)

// named exports only

export const validationOptions = { convert: false, abortEarly: false }

export default { receivedEventSchema, validationOptions }
