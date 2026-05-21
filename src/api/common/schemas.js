import Joi from 'joi'

export const createCasePayloadSchema = Joi.object({
    caseType: Joi.string().required(),
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
