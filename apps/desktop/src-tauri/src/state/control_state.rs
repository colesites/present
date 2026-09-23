//! What the pedals, MIDI and OSC are set up to do, and the ports they hold.
//!
//! One writer for the file, and the listeners restart whenever it changes: a
//! binding the operator adds during setup takes effect on the next press, not
//! the next launch.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;

use crate::errors::AppResult;
use crate::services::control::midi::MidiListener;
use crate::services::control::osc::OscListener;
use crate::services::control::ControlConfig;

use super::persist;

const CONTROL_FILE: &str = "control.json";

#[derive(Default)]
struct Listening {
    midi: MidiListener,
    osc: OscListener,
}

pub struct ControlState {
    config: Mutex<ControlConfig>,
    listening: Mutex<Listening>,
    path: PathBuf,
}

impl ControlState {
    /// Load what was set up, or the defaults, without opening anything yet.
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(CONTROL_FILE);
        let config: ControlConfig = persist::load_or_default(&path, "control settings");
        Self {
            config: Mutex::new(config),
            listening: Mutex::new(Listening::default()),
            path,
        }
    }

    pub fn snapshot(&self) -> ControlConfig {
        self.config
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    /// Open the ports the settings ask for, closing whatever was open.
    pub fn listen(&self, app: &AppHandle) {
        let config = self.snapshot();
        let mut listening = self
            .listening
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // The old listeners go first: a port cannot be opened twice.
        *listening = Listening::default();
        *listening = Listening {
            midi: MidiListener::start(app, &config.midi),
            osc: OscListener::start(app, &config.osc),
        };
    }

    /// Save new settings and listen as they say.
    pub fn set(&self, app: &AppHandle, config: ControlConfig) -> AppResult<ControlConfig> {
        {
            let mut held = self
                .config
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            *held = config;
            persist::save_atomic(&self.path, &*held)?;
        }
        self.listen(app);
        Ok(self.snapshot())
    }

    /// What is actually open, which is not always what was asked for: a MIDI
    /// port can be unplugged and an OSC port taken by something else.
    pub fn listening(&self) -> (bool, Option<u16>) {
        let listening = self
            .listening
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        (listening.midi.is_listening(), listening.osc.port())
    }
}
