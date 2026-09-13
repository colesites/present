//! NDI: sending the audience frame onto the network, and receiving sources for
//! props.
//!
//! Electron reaches NDI through grandi, a Node addon over the NDI SDK, and
//! feeds its sender by calling `capturePage()` on the audience window thirty
//! times a second (`ndi.service.ts:325`). Tauri has no equivalent of that
//! capture, which is the blocker ADR-001 was written for; here the frames come
//! from the Rust compositor instead.
//!
//! ```text
//! rules     the characterised behaviour, shared with Electron. No FFI.
//! library   where the NDI runtime is found, and loading it
//! sys       the C interface, resolved from the loaded runtime
//! finder    discovery
//! sender    one source on the network
//! receiver  one source received
//! ```
//!
//! Only `rules` and `library` are safe to reason about without the SDK
//! documentation to hand. Everything that crosses into C is in `sys`, and the
//! three wrappers are the only code that calls it.

pub mod finder;
pub mod library;
pub mod receiver;
pub mod rules;
pub mod sender;
mod sys;

pub use library::LoadedRuntime;
pub use sys::NdiLib;
