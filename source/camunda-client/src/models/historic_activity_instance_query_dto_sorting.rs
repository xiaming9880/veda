/*
 * Camunda BPM REST API
 *
 * OpenApi Spec for Camunda BPM REST API.
 *
 * The version of the OpenAPI document: 7.14.0
 * 
 * Generated by: https://openapi-generator.tech
 */




#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HistoricActivityInstanceQueryDtoSorting {
    /// Sort the results lexicographically by a given criterion. Must be used in conjunction with the sortOrder parameter.
    #[serde(rename = "sortBy", skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<SortBy>,
    /// Sort the results in a given order. Values may be `asc` for ascending order or `desc` for descending order. Must be used in conjunction with the sortBy parameter.
    #[serde(rename = "sortOrder", skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<SortOrder>,
}

impl HistoricActivityInstanceQueryDtoSorting {
    pub fn new() -> HistoricActivityInstanceQueryDtoSorting {
        HistoricActivityInstanceQueryDtoSorting {
            sort_by: None,
            sort_order: None,
        }
    }
}

/// Sort the results lexicographically by a given criterion. Must be used in conjunction with the sortOrder parameter.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum SortBy {
    #[serde(rename = "activityInstanceId")]
    ActivityInstanceId,
    #[serde(rename = "instanceId")]
    InstanceId,
    #[serde(rename = "executionId")]
    ExecutionId,
    #[serde(rename = "activityId")]
    ActivityId,
    #[serde(rename = "activityName")]
    ActivityName,
    #[serde(rename = "activityType")]
    ActivityType,
    #[serde(rename = "startTime")]
    StartTime,
    #[serde(rename = "endTime")]
    EndTime,
    #[serde(rename = "duration")]
    Duration,
    #[serde(rename = "definitionId")]
    DefinitionId,
    #[serde(rename = "occurrence")]
    Occurrence,
    #[serde(rename = "tenantId")]
    TenantId,
}
/// Sort the results in a given order. Values may be `asc` for ascending order or `desc` for descending order. Must be used in conjunction with the sortBy parameter.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum SortOrder {
    #[serde(rename = "asc")]
    Asc,
    #[serde(rename = "desc")]
    Desc,
}

