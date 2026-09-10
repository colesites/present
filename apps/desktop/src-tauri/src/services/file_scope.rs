//! The containment boundary for every path the renderer can name.
//!
//! Electron has none. `local-media://` hands the URL pathname straight to
//! `fs.stat` and `fs.createReadStream` (`protocol.service.ts:137-145`), and the
//! file commands in `file.ipc.ts` pass their arguments to `node:fs` unchecked,
//! so a compromised renderer reads any file the operator can read. That is
//! known-issues §3 and closing it is the Stage 3 gate.
//!
//! The rule here is deliberately narrow: a path is reachable only if it sits
//! inside a directory the operator themselves chose. Two ways to choose one:
//!
//! * a **media root** — a folder added in the Media panel, persisted across
//!   restarts, and the only kind that survives a relaunch;
//! * a **session grant** — a file or folder picked in a native dialog during
//!   this run, forgotten when the app exits.
//!
//! Nothing else grants access. There is no configuration that widens it and no
//! command that adds a root without a dialog the operator saw.
//!
//! This module holds no Tauri types so the rule can be tested directly.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use crate::errors::{AppError, AppResult};

/// Where a root came from. Only `Media` roots are written to disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Grant {
    /// A media folder the operator added. Persisted.
    Media,
    /// A path picked in a dialog during this run. Not persisted.
    Session,
}

/// The set of reachable directories.
#[derive(Debug, Default)]
pub struct FileScope {
    media: BTreeSet<PathBuf>,
    session: BTreeSet<PathBuf>,
}

impl FileScope {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a directory to the scope, returning its canonical form.
    ///
    /// The path is canonicalised on the way in so that later containment checks
    /// compare like with like: on macOS `/tmp` is a symlink to `/private/tmp`,
    /// and a root stored unresolved would match nothing.
    pub fn allow_dir(&mut self, path: &Path, grant: Grant) -> AppResult<PathBuf> {
        let canonical = canonicalize_existing(path)?;
        if !canonical.is_dir() {
            return Err(AppError::Invalid(format!(
                "{} is not a folder.",
                canonical.display()
            )));
        }
        self.set_mut(grant).insert(canonical.clone());
        Ok(canonical)
    }

    /// Grant access to a single picked file by admitting the folder it sits in.
    ///
    /// Whole-folder rather than single-file because the webview asks for more
    /// than the file itself: a video is fetched in ranges, and a picked asset
    /// is re-read every time the surface showing it remounts. Narrowing this to
    /// one file would mean tracking every derived request, and the operator has
    /// already shown they trust that folder by browsing to it.
    pub fn allow_file(&mut self, path: &Path, grant: Grant) -> AppResult<PathBuf> {
        let canonical = canonicalize_existing(path)?;
        let parent = canonical
            .parent()
            .ok_or_else(|| AppError::Invalid(format!("{} has no folder.", canonical.display())))?;
        self.set_mut(grant).insert(parent.to_path_buf());
        Ok(canonical)
    }

    /// Forget a media root. Session grants cannot be revoked individually —
    /// they last exactly as long as the run.
    pub fn revoke_media(&mut self, path: &Path) {
        let canonical = canonicalize_existing(path).unwrap_or_else(|_| path.to_path_buf());
        self.media.remove(&canonical);
    }

    pub fn media_roots(&self) -> impl Iterator<Item = &PathBuf> {
        self.media.iter()
    }

    /// Is this already-canonical path inside the scope?
    pub fn contains(&self, canonical: &Path) -> bool {
        self.media
            .iter()
            .chain(self.session.iter())
            .any(|root| is_within(root, canonical))
    }

    /// Resolve a path the renderer supplied for an operation on something that
    /// must already exist, rejecting anything outside the scope.
    pub fn resolve_existing(&self, path: &str) -> AppResult<PathBuf> {
        let canonical = canonicalize_existing(Path::new(path))?;
        self.guard(canonical)
    }

    /// Resolve a path for something about to be created — a copy target, a new
    /// folder, a rename destination.
    ///
    /// The destination does not exist yet, so canonicalisation stops at the
    /// deepest ancestor that does. That ancestor is what gets checked, which is
    /// the right question: a caller may only create a file where it may already
    /// read one.
    pub fn resolve_new(&self, path: &str) -> AppResult<PathBuf> {
        let canonical = canonicalize_for_create(Path::new(path))?;
        self.guard(canonical)
    }

    fn guard(&self, canonical: PathBuf) -> AppResult<PathBuf> {
        if self.contains(&canonical) {
            return Ok(canonical);
        }
        // The message names the path but not the scope: an operator needs to
        // know which file was refused, and nothing is served by listing every
        // folder the app can reach.
        Err(AppError::Denied(format!(
            "{} is outside the folders this app may use.",
            canonical.display()
        )))
    }

    fn set_mut(&mut self, grant: Grant) -> &mut BTreeSet<PathBuf> {
        match grant {
            Grant::Media => &mut self.media,
            Grant::Session => &mut self.session,
        }
    }
}

/// Ancestor-or-self, compared component by component.
///
/// String prefixes are wrong here: `/Volumes/Media-old` starts with
/// `/Volumes/Media` and is a different folder.
fn is_within(root: &Path, candidate: &Path) -> bool {
    let mut root_parts = root.components();
    let mut candidate_parts = candidate.components();

    loop {
        match (root_parts.next(), candidate_parts.next()) {
            (None, _) => return true,
            (Some(_), None) => return false,
            (Some(left), Some(right)) if left == right => continue,
            _ => return false,
        }
    }
}

/// Fully resolve a path that exists, following symlinks.
///
/// Symlink resolution is the point. Without it a link inside a media folder
/// pointing at `~/.ssh` would pass a purely lexical check.
fn canonicalize_existing(path: &Path) -> AppResult<PathBuf> {
    std::fs::canonicalize(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => AppError::NotFound(path.display().to_string()),
        _ => AppError::Io(error),
    })
}

/// Resolve a path whose final components do not exist yet.
///
/// Canonicalises the deepest existing ancestor and re-applies the rest, so the
/// symlinks that *do* exist are still followed. `..` in the non-existent tail is
/// refused rather than collapsed: there is no legitimate caller, and collapsing
/// it lexically is exactly the mistake this module exists to avoid.
fn canonicalize_for_create(path: &Path) -> AppResult<PathBuf> {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return Ok(canonical);
    }

    let file_name = path
        .components()
        .next_back()
        .ok_or_else(|| AppError::Invalid("A path is required.".to_owned()))?;
    let name = match file_name {
        Component::Normal(name) => name,
        _ => {
            return Err(AppError::Invalid(format!(
                "{} is not a path this app will create.",
                path.display()
            )))
        }
    };

    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid(format!("{} has no folder.", path.display())))?;

    Ok(canonicalize_for_create(parent)?.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real directory tree, because the whole point of this module is that it
    /// touches the filesystem — a scope tested against synthetic paths would
    /// never exercise symlink resolution, which is where the escapes are.
    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "present-file-scope-{label}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).expect("temp dir");
            Self {
                root: std::fs::canonicalize(&root).expect("canonical temp dir"),
            }
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.root.join(relative);
            std::fs::create_dir_all(&path).expect("dir");
            path
        }

        fn file(&self, relative: &str, contents: &str) -> PathBuf {
            let path = self.root.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("parent");
            }
            std::fs::write(&path, contents).expect("file");
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn scope_over(dirs: &[&Path]) -> FileScope {
        let mut scope = FileScope::new();
        for dir in dirs {
            scope.allow_dir(dir, Grant::Media).expect("allowed");
        }
        scope
    }

    #[test]
    fn a_file_inside_a_media_root_resolves() {
        let fixture = Fixture::new("inside");
        let media = fixture.dir("media");
        let song = fixture.file("media/song.mp4", "video");
        let scope = scope_over(&[&media]);

        assert_eq!(
            scope
                .resolve_existing(song.to_str().expect("utf-8"))
                .expect("in scope"),
            song
        );
    }

    #[test]
    fn a_nested_file_resolves() {
        let fixture = Fixture::new("nested");
        let media = fixture.dir("media");
        let clip = fixture.file("media/2026/easter/clip.mov", "video");
        let scope = scope_over(&[&media]);

        assert!(scope
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_ok());
    }

    #[test]
    fn a_file_outside_every_root_is_refused() {
        let fixture = Fixture::new("outside");
        let media = fixture.dir("media");
        let secret = fixture.file("private/keys.txt", "secret");
        let scope = scope_over(&[&media]);

        let error = scope
            .resolve_existing(secret.to_str().expect("utf-8"))
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    /// The exact shape of the Electron hole: a `..` walk out of a media folder.
    #[test]
    fn dot_dot_cannot_climb_out_of_a_root() {
        let fixture = Fixture::new("dotdot");
        let media = fixture.dir("media");
        fixture.file("private/keys.txt", "secret");
        let scope = scope_over(&[&media]);

        let escape = media.join("../private/keys.txt");
        let error = scope
            .resolve_existing(escape.to_str().expect("utf-8"))
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn dot_dot_inside_a_root_is_fine() {
        let fixture = Fixture::new("dotdot-inside");
        let media = fixture.dir("media");
        let clip = fixture.file("media/videos/clip.mp4", "video");
        fixture.dir("media/images");
        let scope = scope_over(&[&media]);

        let roundabout = media.join("images/../videos/clip.mp4");
        assert_eq!(
            scope
                .resolve_existing(roundabout.to_str().expect("utf-8"))
                .expect("in scope"),
            clip
        );
    }

    /// A sibling whose name merely starts with a root's name. A string prefix
    /// check passes this; a component check does not.
    #[test]
    fn a_sibling_with_a_shared_name_prefix_is_refused() {
        let fixture = Fixture::new("prefix");
        let media = fixture.dir("Media");
        let decoy = fixture.file("Media-old/keys.txt", "secret");
        let scope = scope_over(&[&media]);

        let error = scope
            .resolve_existing(decoy.to_str().expect("utf-8"))
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_a_root_is_refused() {
        let fixture = Fixture::new("symlink");
        let media = fixture.dir("media");
        let secret = fixture.file("private/keys.txt", "secret");
        std::os::unix::fs::symlink(&secret, media.join("innocent.mp4")).expect("symlink");
        let scope = scope_over(&[&media]);

        let error = scope
            .resolve_existing(media.join("innocent.mp4").to_str().expect("utf-8"))
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_is_matched_through_the_link() {
        // macOS hands out `/tmp/...` paths that are really `/private/tmp/...`.
        // A root stored unresolved would match nothing at all.
        let fixture = Fixture::new("symlink-root");
        let real = fixture.dir("real-media");
        let link = fixture.root.join("linked-media");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        let clip = fixture.file("real-media/clip.mp4", "video");

        let scope = scope_over(&[&link]);
        assert!(scope
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_ok());
    }

    #[test]
    fn a_missing_file_reports_not_found_not_denied() {
        let fixture = Fixture::new("missing");
        let media = fixture.dir("media");
        let scope = scope_over(&[&media]);

        let error = scope
            .resolve_existing(media.join("absent.mp4").to_str().expect("utf-8"))
            .expect_err("must fail");
        assert!(matches!(error, AppError::NotFound(_)), "got {error:?}");
    }

    #[test]
    fn a_new_path_inside_a_root_resolves_before_it_exists() {
        let fixture = Fixture::new("create");
        let media = fixture.dir("media");
        let scope = scope_over(&[&media]);

        let target = media.join("new-folder").join("copy.mp4");
        assert_eq!(
            scope
                .resolve_new(target.to_str().expect("utf-8"))
                .expect("in scope"),
            target
        );
    }

    #[test]
    fn a_new_path_outside_every_root_is_refused() {
        let fixture = Fixture::new("create-outside");
        let media = fixture.dir("media");
        fixture.dir("private");
        let scope = scope_over(&[&media]);

        let error = scope
            .resolve_new(
                fixture
                    .root
                    .join("private/planted.mp4")
                    .to_str()
                    .expect("utf-8"),
            )
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn a_new_path_cannot_use_dot_dot_to_pick_its_folder() {
        let fixture = Fixture::new("create-dotdot");
        let media = fixture.dir("media");
        fixture.dir("private");
        let scope = scope_over(&[&media]);

        let escape = media.join("subfolder/../../private/planted.mp4");
        let error = scope
            .resolve_new(escape.to_str().expect("utf-8"))
            .expect_err("must be refused");
        // `subfolder` does not exist, so the `..` lands in the tail this
        // module refuses to collapse.
        assert!(
            matches!(error, AppError::Invalid(_) | AppError::Denied(_)),
            "got {error:?}"
        );
    }

    #[test]
    fn session_grants_and_media_roots_both_admit() {
        let fixture = Fixture::new("grants");
        let media = fixture.dir("media");
        let picked = fixture.file("elsewhere/prop.png", "image");

        let mut scope = scope_over(&[&media]);
        assert!(scope
            .resolve_existing(picked.to_str().expect("utf-8"))
            .is_err());

        scope.allow_file(&picked, Grant::Session).expect("granted");
        assert!(scope
            .resolve_existing(picked.to_str().expect("utf-8"))
            .is_ok());
    }

    #[test]
    fn only_media_roots_are_listed_for_persistence() {
        let fixture = Fixture::new("listing");
        let media = fixture.dir("media");
        let transient = fixture.dir("elsewhere");

        let mut scope = scope_over(&[&media]);
        scope
            .allow_dir(&transient, Grant::Session)
            .expect("granted");

        let roots: Vec<_> = scope.media_roots().cloned().collect();
        assert_eq!(roots, vec![media]);
    }

    #[test]
    fn revoking_a_media_root_closes_it() {
        let fixture = Fixture::new("revoke");
        let media = fixture.dir("media");
        let clip = fixture.file("media/clip.mp4", "video");
        let mut scope = scope_over(&[&media]);

        scope.revoke_media(&media);
        assert!(scope
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_err());
    }

    #[test]
    fn an_empty_scope_admits_nothing() {
        let fixture = Fixture::new("empty");
        let clip = fixture.file("media/clip.mp4", "video");
        let scope = FileScope::new();

        assert!(scope
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_err());
    }

    #[test]
    fn a_file_cannot_be_granted_as_a_folder() {
        let fixture = Fixture::new("file-as-dir");
        let clip = fixture.file("media/clip.mp4", "video");
        let mut scope = FileScope::new();

        let error = scope
            .allow_dir(&clip, Grant::Media)
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Invalid(_)), "got {error:?}");
    }
}
