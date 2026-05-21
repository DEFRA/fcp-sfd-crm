import Joi from 'joi'
import { createCasePayloadSchema } from '../schemas/http.js'

// Inbound CloudEvents payload schema (expects CloudEvents wrapper with data)
export const inboundCloudEventSchema = Joi.object({
    id: Joi.string().required(),
    source: Joi.string().required(),
    specversion: Joi.string().required(),
    type: Joi.string().required(),
    datacontenttype: Joi.string().required(),
    time: Joi.string().isoDate().required(),
    data: Joi.object({
        crn: Joi.string().required(),
        sbi: Joi.string().required(),
        crm: Joi.object().optional(),
        file: Joi.object({
            fileId: Joi.string().required(),
            fileName: Joi.string().required(),
            mimeType: Joi.string().optional()
        }).required(),
        correlationId: Joi.string().required()
    }).required()
}).required()

// Outbound received event schema (CloudEvents produced by this service)
export const receivedEventSchema = Joi.object({
    id: Joi.string().required(),
    source: Joi.string().required(),
    specversion: Joi.string().required(),
    type: Joi.string().required(),
    datacontenttype: Joi.string().required(),
    time: Joi.string().isoDate().required(),
    data: Joi.object({
        correlationId: Joi.string().required(),
        caseId: Joi.string().optional(),
        crn: Joi.string().optional(),
        sbi: Joi.string().optional(),
        caseType: Joi.string().optional()
    }).required()
}).required()

export const validationOptions = { convert: false, abortEarly: false }

export default {
    createCasePayloadSchema,
    inboundCloudEventSchema,
    receivedEventSchema,
    validationOptions
}
