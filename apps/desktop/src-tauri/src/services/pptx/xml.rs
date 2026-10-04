//! Reading a part's XML: namespaces, children and numbers, as DrawingML
//! writes them.

use roxmltree::Node;

pub const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub const P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
pub const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub const MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
pub const DSP: &str = "http://schemas.microsoft.com/office/drawing/2008/diagram";

pub fn is(node: Node, ns: &str, name: &str) -> bool {
    node.is_element() && node.tag_name().namespace() == Some(ns) && node.tag_name().name() == name
}

pub fn child<'a, 'i>(node: Node<'a, 'i>, ns: &str, name: &str) -> Option<Node<'a, 'i>> {
    node.children().find(|candidate| is(*candidate, ns, name))
}

pub fn children<'a, 'i, 'n>(
    node: Node<'a, 'i>,
    ns: &'n str,
    name: &'n str,
) -> impl Iterator<Item = Node<'a, 'i>> + 'n
where
    'a: 'n,
    'i: 'n,
{
    node.children()
        .filter(move |candidate| is(*candidate, ns, name))
}

pub fn elements<'a, 'i>(node: Node<'a, 'i>) -> impl Iterator<Item = Node<'a, 'i>> {
    node.children().filter(Node::is_element)
}

/// A path of children: `path(node, A, &["bodyPr", "normAutofit"])`.
pub fn path<'a, 'i>(node: Node<'a, 'i>, ns: &str, names: &[&str]) -> Option<Node<'a, 'i>> {
    names
        .iter()
        .try_fold(node, |current, name| child(current, ns, name))
}

pub fn int(node: Node, name: &str) -> Option<i64> {
    let text = node.attribute(name)?.trim();
    text.parse::<i64>()
        .ok()
        .or_else(|| text.parse::<f64>().ok().map(|value| value.round() as i64))
}

pub fn float(node: Node, name: &str) -> Option<f64> {
    node.attribute(name)?.trim().parse::<f64>().ok()
}

/// An `ST_Percentage`: `50000` or, in strict files, `"50%"`. As a fraction.
pub fn percent(node: Node, name: &str) -> Option<f64> {
    let text = node.attribute(name)?.trim();
    match text.strip_suffix('%') {
        Some(number) => number.trim().parse::<f64>().ok().map(|value| value / 100.0),
        None => text.parse::<f64>().ok().map(|value| value / 100_000.0),
    }
}

pub fn flag(node: Node, name: &str) -> Option<bool> {
    match node.attribute(name)?.trim() {
        "1" | "true" | "on" => Some(true),
        "0" | "false" | "off" => Some(false),
        _ => None,
    }
}

/// The element a markup-compatibility block stands for: its fallback, which
/// is what any reader that does not know the extension shows; else its first
/// choice.
pub fn resolve_alternate<'a, 'i>(node: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    if !is(node, MC, "AlternateContent") {
        return Some(node);
    }
    child(node, MC, "Fallback")
        .or_else(|| child(node, MC, "Choice"))
        .and_then(|branch| elements(branch).next())
}
