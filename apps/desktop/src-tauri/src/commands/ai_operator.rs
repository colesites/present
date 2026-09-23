//! The AI Operator's tool definitions. Replaces `ai-operator:list-tools`.
//!
//! The operator itself runs in the operator window; this only lists what it
//! can do. The list is `src/shared/ai-operator/present-tools.json`, the file the
//! Electron build imports, compiled in so the two cannot drift.

use crate::errors::AppResult;

const PRESENT_TOOLS: &str = include_str!("../../../src/shared/ai-operator/present-tools.json");

fn present_tools() -> AppResult<serde_json::Value> {
    serde_json::from_str(PRESENT_TOOLS).map_err(|error| {
        crate::errors::AppError::Invalid(format!("The operator tool list is not JSON: {error}"))
    })
}

#[tauri::command]
pub async fn list_ai_operator_tools() -> AppResult<serde_json::Value> {
    present_tools()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_compiled_in_list_is_the_shared_file_and_parses() {
        let tools = present_tools().unwrap();
        let tools = tools.as_array().unwrap();
        assert_eq!(tools.len(), 46);
        assert_eq!(tools[0]["name"], "open_song");
        assert_eq!(tools[45]["name"], "open_settings");
    }
}
