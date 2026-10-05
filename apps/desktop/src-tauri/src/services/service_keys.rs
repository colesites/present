//! The AssemblyAI, Groq and AI Gateway keys, built into the app.
//!
//! The listening agents call these services from here rather than through the
//! website. The keys come from the build's environment (`build.rs`), kept
//! scrambled so neither is in the app as readable text. That keeps them out
//! of a casual look, not out of reach: the app puts each back together to use
//! it, and so can anyone who takes the app apart. The spending limits on the
//! accounts are what bound the cost of a key that gets out.

mod built {
    include!(concat!(env!("OUT_DIR"), "/service_keys.rs"));
}

fn reveal((scrambled, mask): (&[u8], &[u8])) -> Option<String> {
    let bytes: Vec<u8> = scrambled
        .iter()
        .zip(mask)
        .map(|(byte, mask)| byte ^ mask)
        .collect();
    String::from_utf8(bytes).ok().filter(|key| !key.is_empty())
}

/// AssemblyAI's key, or `None` for a build made without one.
pub fn assemblyai() -> Option<String> {
    reveal(built::ASSEMBLYAI)
}

/// The Vercel AI Gateway's key, or `None` for a build made without one.
pub fn ai_gateway() -> Option<String> {
    reveal(built::AI_GATEWAY)
}

/// Groq's key, or `None` for a build made without one.
pub fn groq() -> Option<String> {
    reveal(built::GROQ)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scrambled_key_comes_back_as_it_was() {
        let key = b"sk-test-123";
        let mask = [7u8, 99, 1, 250, 0, 13, 77, 8, 3, 200, 42];
        let scrambled: Vec<u8> = key
            .iter()
            .zip(&mask)
            .map(|(byte, mask)| byte ^ mask)
            .collect();
        assert_ne!(scrambled.as_slice(), key, "not in the app as itself");
        assert_eq!(reveal((&scrambled, &mask)).as_deref(), Some("sk-test-123"));
        assert_eq!(reveal((&[], &[])), None, "a build without a key has none");
    }
}
