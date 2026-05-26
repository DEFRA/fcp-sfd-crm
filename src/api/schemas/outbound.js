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
        caseId: Joi.string().guid({ version: 'uuidv4' }).required(),
        crn: Joi.number().integer().min(1050000000).max(9999999999).required(),
        sbi: Joi.number().integer().min(105000000).max(999999999).required(),
        caseType: Joi.string().optional(),
        onlineSubmissionActivities: Joi.array().items(Joi.object({
            id: Joi.string().required(),
            fileId: Joi.string().required(),
            time: Joi.string().isoDate().required()
        })).optional()
    }).required()
}).required()

// named exports only

export const validationOptions = { convert: false, abortEarly: false }

export default { receivedEventSchema, validationOptions }
