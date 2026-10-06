// Dataverse columns whose filter operand is a CRN.
//
// A CRN and an SBI are both just digits, so nothing about the value identifies
// which is which — the column name is the only signal. Declaring the names here
// means the query that filters on a CRN and the log masker that redacts it read
// from the same source and cannot drift apart.
//
// Any new column that carries a CRN must be added to CRN_FILTER_FIELDS, or it
// will be logged in full.
export const CRN_FILTER_FIELD = 'rpa_capcustomerid'

export const CRN_FILTER_FIELDS = [CRN_FILTER_FIELD]
