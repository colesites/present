//! The single error type crossing the Rust → JavaScript boundary.
//!
//! Every command returns `Result<T, AppError>`. The frontend therefore always
//! sees the same shape — `{ kind, message }` — instead of the loose mix of
//! `null`, `false` and thrown strings the Electron IPC layer returns today.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Tauri(#[from] tauri::Error),

    /// The caller asked for something that does not exist (window, display,
    /// media asset, slide…).
    #[error("{0} not found")]
    NotFound(String),

    /// The request was well-formed but not valid right now.
    #[error("{0}")]
    Invalid(String),
}

/// Machine-readable discriminant so the UI can branch without string matching.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppErrorKind {
    Io,
    Tauri,
    NotFound,
    Invalid,
}

impl AppError {
    pub fn kind(&self) -> AppErrorKind {
        match self {
            Self::Io(_) => AppErrorKind::Io,
            Self::Tauri(_) => AppErrorKind::Tauri,
            Self::NotFound(_) => AppErrorKind::NotFound,
            Self::Invalid(_) => AppErrorKind::Invalid,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;

        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", &self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_kind_and_message() {
        let error = AppError::NotFound("display 42".to_owned());
        let json = serde_json::to_value(&error).expect("serializable");

        assert_eq!(json["kind"], "not-found");
        assert_eq!(json["message"], "display 42 not found");
    }

    #[test]
    fn io_errors_keep_their_message() {
        let error = AppError::from(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "nope",
        ));
        let json = serde_json::to_value(&error).expect("serializable");

        assert_eq!(json["kind"], "io");
        assert_eq!(json["message"], "nope");
    }
}
