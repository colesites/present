//! A slide's transition and timing, as PowerPoint keeps them.
//!
//! `p:transition` names its effect by a child element (`p:push dir="u"`,
//! `p14:vortex`, `p15:prstTrans prst="curtains"`), its length by `p14:dur`
//! in milliseconds or `spd` (fast, medium, slow), and whether the slide moves
//! on by itself by `advTm`. The newer effects sit in a markup-compatibility
//! block whose fallback is an older one: the newer is read when it has a
//! match here, else the fallback.
//!
//! Each effect becomes the nearest of the app's transitions
//! (`compositor/transition/registry.rs`); one the engine does not draw yet
//! is shown as a fade by the engine itself.

use roxmltree::Node;
use serde_json::Value;

use super::xml::{self, MC, P};
use crate::services::compositor::transition::{registry, Easing, Mode};

/// The longest a transition may be (`transition::config::MAX_DURATION_MS`).
const MAX_DURATION_MS: f64 = 5_000.0;

/// What a slide carries: its transition, and how long it stays before moving
/// on by itself.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Timing {
    pub transition: Option<Value>,
    pub advance_after_ms: Option<u64>,
}

/// The `p:transition` elements a slide offers, the richest first.
fn candidates<'a, 'i>(slide_root: Node<'a, 'i>) -> Vec<Node<'a, 'i>> {
    let mut found = Vec::new();
    for child in xml::elements(slide_root) {
        if xml::is(child, P, "transition") {
            found.push(child);
        } else if xml::is(child, MC, "AlternateContent") {
            for branch in ["Choice", "Fallback"] {
                for holder in xml::children(child, MC, branch) {
                    found.extend(xml::children(holder, P, "transition"));
                }
            }
        }
    }
    found
}

/// The app's transition for one PowerPoint effect element.
fn effect_id(effect: Node) -> Option<&'static str> {
    let dir = effect.attribute("dir").unwrap_or("");
    let horizontal = effect.attribute("orient") != Some("vert");
    let toward = |left: &'static str,
                  right: &'static str,
                  up: &'static str,
                  down: &'static str,
                  default: &'static str| match dir {
        "l" => left,
        "r" => right,
        "u" => up,
        "d" => down,
        _ => default,
    };
    Some(match effect.tag_name().name() {
        "cut" => "cut",
        "fade" => {
            if effect
                .attribute("thruBlk")
                .is_some_and(|v| v == "1" || v == "true")
            {
                "dip-to-black"
            } else {
                "fade"
            }
        }
        "dissolve" => "fade",
        "push" => toward("push-left", "push-right", "push-up", "push-down", "push-up"),
        "wipe" => toward(
            "wipe-left",
            "wipe-right",
            "wipe-up",
            "wipe-down",
            "wipe-left",
        ),
        "cover" => toward(
            "cover-left",
            "cover-right",
            "cover-up",
            "cover-down",
            "cover-left",
        ),
        "pull" => toward(
            "reveal-left",
            "reveal-right",
            "reveal-up",
            "reveal-down",
            "reveal-left",
        ),
        "split" => match (horizontal, dir) {
            (_, "in") => "close-to-center",
            (true, _) => "split-horizontal",
            (false, _) => "split-vertical",
        },
        "zoom" => {
            if dir == "out" {
                "zoom-out"
            } else {
                "zoom-in"
            }
        }
        "circle" => "circle-reveal",
        "diamond" => "diamond-reveal",
        "plus" => "square-reveal",
        "wheel" | "wheelReverse" => "clockwise-wipe",
        "wedge" => "radial-wipe",
        "blinds" | "comb" | "randomBar" | "checker" => {
            if horizontal {
                "blinds-horizontal"
            } else {
                "blinds-vertical"
            }
        }
        "strips" => "wipe-diagonal",
        "newsflash" | "vortex" => "spin",
        "random" => "fade",
        // PowerPoint 2010 and later.
        "ripple" => "ripple",
        "flip" => "flip-horizontal",
        "prism" | "cube" => toward(
            "cube-left",
            "cube-right",
            "cube-up",
            "cube-down",
            "cube-left",
        ),
        "doors" => "doors-open",
        "window" => "doors-open",
        "ferris" => "rotate",
        "gallery" => "slide-left",
        "conveyor" => "push-left",
        "pan" => toward("push-left", "push-right", "push-up", "push-down", "push-up"),
        "glitter" => "pixel-dissolve",
        "honeycomb" => "mosaic",
        "flash" => "white-flash",
        "shred" => "shatter",
        "switch" => "card-flip",
        "reveal" => "dip-to-black",
        "warp" => "zoom-in",
        "flythrough" => "zoom-through",
        "morph" => "crossfade",
        // PowerPoint 2013 and later: `p15:prstTrans prst="…"`.
        "prstTrans" => match effect.attribute("prst").unwrap_or("") {
            "curtains" | "drape" => "curtains-open",
            "wind" => "slide-left",
            "airplane" => "slide-up",
            "fracture" | "crush" => "shatter",
            "peelOff" | "pageCurlDouble" | "pageCurlSingle" => "page-curl",
            "origami" => "page-turn",
            "prestige" => "zoom-out",
            _ => "fade",
        },
        _ => return None,
    })
}

/// How long the transition takes, in milliseconds.
fn duration_ms(transition: Node) -> f64 {
    let explicit = transition
        .attributes()
        .find(|attribute| attribute.name() == "dur")
        .and_then(|attribute| attribute.value().parse::<f64>().ok());
    let by_speed = match transition.attribute("spd") {
        Some("fast") => 500.0,
        Some("slow") => 1000.0,
        _ => 750.0,
    };
    explicit.unwrap_or(by_speed).clamp(0.0, MAX_DURATION_MS)
}

/// A slide's transition and timing.
pub fn read(slide_root: Node) -> Timing {
    let mut timing = Timing::default();
    for transition in candidates(slide_root) {
        if timing.advance_after_ms.is_none() {
            timing.advance_after_ms = transition
                .attribute("advTm")
                .and_then(|value| value.parse::<u64>().ok());
        }
        if timing.transition.is_some() {
            continue;
        }
        let Some(effect) = xml::elements(transition).find(|node| effect_id(*node).is_some()) else {
            continue;
        };
        let id = effect_id(effect).unwrap_or("fade");
        // The registry's own transition for it, so the direction it draws in
        // is the preset's (`push-up` goes up), then PowerPoint's length.
        let mut chosen = registry::transition_for(id);
        chosen.duration_ms = if id == "cut" {
            0
        } else {
            duration_ms(transition).round() as u32
        };
        chosen.easing = Easing::EaseInOut;
        // A PowerPoint transition moves the whole slide.
        chosen.mode = Mode::FullSlide;
        timing.transition = serde_json::to_value(chosen).ok();
    }
    timing
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    fn timing(inner: &str) -> Timing {
        let xml = format!(
            r#"<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
                xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"
                xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main">{inner}</p:sld>"#
        );
        let document = Document::parse(&xml).unwrap();
        read(document.root_element())
    }

    #[test]
    fn an_old_transition_with_its_speed() {
        let found = timing(r#"<p:transition spd="slow"><p:push dir="u"/></p:transition>"#);
        let push = found.transition.unwrap();
        assert_eq!(push["type"], "push-up");
        assert_eq!(push["direction"], "up");
        let fast = timing(r#"<p:transition spd="fast"><p:fade thruBlk="1"/></p:transition>"#);
        let fast = fast.transition.unwrap();
        assert_eq!(fast["type"], "dip-to-black");
        assert_eq!(fast["durationMs"], 500);
    }

    #[test]
    fn a_newer_transition_is_read_before_its_fallback() {
        let found = timing(
            r#"<mc:AlternateContent>
                 <mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="2000"><p14:vortex dir="r"/></p:transition></mc:Choice>
                 <mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>
               </mc:AlternateContent>"#,
        );
        let transition = found.transition.unwrap();
        assert_eq!(transition["type"], "spin");
        assert_eq!(transition["durationMs"], 2000);
        assert_eq!(transition["mode"], "full-slide");
        assert_eq!(
            transition["direction"], "clockwise",
            "the preset's own direction"
        );
    }

    #[test]
    fn an_unknown_newer_one_falls_back() {
        let found = timing(
            r#"<mc:AlternateContent>
                 <mc:Choice Requires="p99"><p:transition><p:somethingNew/></p:transition></mc:Choice>
                 <mc:Fallback><p:transition><p:wipe dir="d"/></p:transition></mc:Fallback>
               </mc:AlternateContent>"#,
        );
        assert_eq!(found.transition.unwrap()["type"], "wipe-down");
    }

    #[test]
    fn a_slide_that_moves_on_by_itself() {
        let found =
            timing(r#"<p:transition advTm="5000"><p15:prstTrans prst="curtains"/></p:transition>"#);
        assert_eq!(found.advance_after_ms, Some(5000));
        assert_eq!(found.transition.unwrap()["type"], "curtains-open");
        assert_eq!(timing("").transition, None);
    }
}
