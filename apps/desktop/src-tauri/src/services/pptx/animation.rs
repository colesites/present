//! A slide's animations, as builds (`compositor/build.rs`).
//!
//! PowerPoint keeps a slide's animations in `p:timing`: a main sequence of
//! click groups, each holding effects. An effect (`p:cTn` with a
//! `presetClass`) names its kind (`entr` arriving, `exit` leaving; emphasis
//! and motion paths have no build to become), its effect (`presetID`, and
//! `presetSubtype` for a direction), when it starts (`nodeType`: on a click,
//! with the previous effect, after it), its delay, and the shape it moves
//! (`p:spTgt spid`, the shape's `cNvPr id`). Each becomes the nearest build:
//! appear, fade, fly, wipe or zoom.
//!
//! The importer tags every element it makes from a slide shape with that
//! shape's id, a group's id included (`SHAPE_TAG`); the builds go on the
//! elements a target names, and the tag is then taken off.

use roxmltree::Node;
use serde_json::{json, Value};

use super::xml::{self, P};

/// The ids of the slide shapes an element came from, while the slide is read.
pub const SHAPE_TAG: &str = "pptxShapeIds";

#[derive(Debug, Clone, PartialEq)]
pub struct Animation {
    pub shape_id: String,
    pub phase: &'static str,
    pub build: Value,
}

/// The effect a preset is drawn as, and whether it comes from a side.
fn effect_of(preset: u32) -> (&'static str, bool) {
    match preset {
        1 => ("appear", false),
        2 | 3 | 7 | 41 | 52 => ("fly", true),
        22 | 12 | 18 | 16 => ("wipe", true),
        21 | 23 | 31 | 53 | 55 | 37 | 47 | 6 | 26 => ("zoom", false),
        _ => ("fade", false),
    }
}

/// PowerPoint's direction flags: top 1, right 2, bottom 4, left 8.
fn direction_of(subtype: u32) -> &'static str {
    if subtype & 8 != 0 {
        "left"
    } else if subtype & 2 != 0 {
        "right"
    } else if subtype & 1 != 0 {
        "top"
    } else {
        "bottom"
    }
}

fn milliseconds(value: Option<&str>) -> Option<f64> {
    value
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|ms| ms.is_finite() && *ms >= 0.0)
}

/// The slide's entrance and exit effects, in the order they run.
pub fn read(slide_root: Node) -> Vec<Animation> {
    let Some(timing) = xml::child(slide_root, P, "timing") else {
        return Vec::new();
    };
    let Some(main) = timing
        .descendants()
        .find(|node| xml::is(*node, P, "cTn") && node.attribute("nodeType") == Some("mainSeq"))
    else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for effect in main
        .descendants()
        .filter(|node| xml::is(*node, P, "cTn") && node.attribute("presetClass").is_some())
    {
        let phase = match effect.attribute("presetClass") {
            Some("entr") => "in",
            Some("exit") => "out",
            _ => continue,
        };
        let Some(shape_id) = effect
            .descendants()
            .find(|node| xml::is(*node, P, "spTgt"))
            .and_then(|target| target.attribute("spid"))
        else {
            continue;
        };
        let preset = effect
            .attribute("presetID")
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);
        let subtype = effect
            .attribute("presetSubtype")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let (name, directed) = effect_of(preset);
        let start = match effect.attribute("nodeType") {
            Some("withEffect") => "with-previous",
            Some("afterEffect") => "after-previous",
            _ => "on-click",
        };
        // Its own delay, and the longest of the timings under it.
        let delay = xml::child(effect, P, "stCondLst")
            .into_iter()
            .flat_map(|list| xml::children(list, P, "cond"))
            .find_map(|cond| milliseconds(cond.attribute("delay")))
            .unwrap_or(0.0);
        let duration = effect
            .descendants()
            .filter(|node| xml::is(*node, P, "cTn") && *node != effect)
            .filter_map(|node| milliseconds(node.attribute("dur")))
            .fold(None, |longest: Option<f64>, ms| {
                Some(longest.map_or(ms, |l| l.max(ms)))
            })
            .unwrap_or(500.0);
        let mut build = json!({
            "effect": name,
            "durationMs": if name == "appear" { 0.0 } else { duration },
            "delayMs": delay,
            "start": start,
            "order": found.len(),
        });
        if directed {
            build["direction"] = json!(direction_of(subtype));
        }
        found.push(Animation {
            shape_id: shape_id.to_owned(),
            phase,
            build,
        });
    }
    found
}

/// The slide's animations put on its elements as builds, and the shape tags
/// taken off. A shape animated twice the same way keeps the first.
pub fn apply(slide_root: Node, elements: &mut [Value]) {
    for animation in read(slide_root) {
        for element in elements.iter_mut() {
            let tagged = element[SHAPE_TAG].as_array().is_some_and(|ids| {
                ids.iter()
                    .any(|id| id.as_str() == Some(animation.shape_id.as_str()))
            });
            if !tagged {
                continue;
            }
            let Some(object) = element.as_object_mut() else {
                continue;
            };
            let builds = object.entry("builds").or_insert_with(|| json!({}));
            if builds.get(animation.phase).is_none() {
                builds[animation.phase] = animation.build.clone();
            }
        }
    }
    for element in elements.iter_mut() {
        if let Some(object) = element.as_object_mut() {
            object.remove(SHAPE_TAG);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    const SLIDE: &str = r#"<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:timing><p:tnLst><p:par>
      <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
        <p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
          <p:par><p:cTn id="3" fill="hold"><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:childTnLst>
            <p:par><p:cTn id="5" presetID="2" presetClass="entr" presetSubtype="8" fill="hold" nodeType="clickEffect">
              <p:stCondLst><p:cond delay="0"/></p:stCondLst>
              <p:childTnLst><p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="6" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst>
            </p:cTn></p:par>
            <p:par><p:cTn id="7" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="afterEffect">
              <p:stCondLst><p:cond delay="250"/></p:stCondLst>
              <p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="8" dur="750"/><p:tgtEl><p:spTgt spid="5"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst>
            </p:cTn></p:par>
            <p:par><p:cTn id="9" presetID="32" presetClass="emph" nodeType="withEffect"><p:childTnLst><p:set><p:cBhvr><p:cTn id="10" dur="1"/><p:tgtEl><p:spTgt spid="5"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
          </p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
          <p:par><p:cTn id="11" fill="hold"><p:childTnLst><p:par><p:cTn id="12" fill="hold"><p:childTnLst>
            <p:par><p:cTn id="13" presetID="1" presetClass="exit" fill="hold" nodeType="clickEffect">
              <p:childTnLst><p:set><p:cBhvr><p:cTn id="14" dur="1"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst>
            </p:cTn></p:par>
          </p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
        </p:childTnLst></p:cTn></p:seq>
      </p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>"#;

    #[test]
    fn entrances_and_exits_become_builds_in_order() {
        let document = Document::parse(SLIDE).unwrap();
        let found = read(document.root_element());
        assert_eq!(found.len(), 3, "the emphasis has no build");
        assert_eq!(found[0].shape_id, "4");
        assert_eq!(found[0].phase, "in");
        assert_eq!(found[0].build["effect"], "fly");
        assert_eq!(found[0].build["direction"], "left");
        assert_eq!(found[0].build["durationMs"], 500.0);
        assert_eq!(found[0].build["start"], "on-click");
        assert_eq!(found[1].build["effect"], "fade");
        assert_eq!(found[1].build["start"], "after-previous");
        assert_eq!(found[1].build["delayMs"], 250.0);
        assert_eq!(found[1].build["durationMs"], 750.0);
        assert_eq!(found[2].phase, "out");
        assert_eq!(found[2].build["effect"], "appear");
        assert_eq!(found[2].build["order"], 2);
    }

    #[test]
    fn builds_go_on_the_elements_a_shape_became() {
        let document = Document::parse(SLIDE).unwrap();
        let mut elements = vec![
            json!({ "id": "pptx_1_1", SHAPE_TAG: ["4"] }),
            json!({ "id": "pptx_1_2", SHAPE_TAG: ["5", "9"] }),
            json!({ "id": "pptx_1_3", SHAPE_TAG: ["6"] }),
        ];
        apply(document.root_element(), &mut elements);
        assert_eq!(elements[0]["builds"]["in"]["effect"], "fly");
        assert_eq!(elements[0]["builds"]["out"]["effect"], "appear");
        assert_eq!(elements[1]["builds"]["in"]["effect"], "fade");
        assert!(elements[2].get("builds").is_none());
        assert!(
            elements
                .iter()
                .all(|element| element.get(SHAPE_TAG).is_none()),
            "tags taken off"
        );
    }
}
