# SDI, through Blackmagic DeckLink

`decklink_shim.cpp` drives a Blackmagic DeckLink or UltraStudio device for a
screen's SDI output (`src/services/sdi.rs`). It schedules frames on the card's
own clock and plays out the newest picture Present hands it, repeating the
last one when nothing newer has come. `build.rs` compiles it on macOS.

`decklink-sdk/` holds the files of Blackmagic's Desktop Video SDK 12.0 that it
needs: the API's headers and `DeckLinkAPIDispatch.cpp`, which finds the API in
`/Library/Frameworks/DeckLinkAPI.framework` when first asked. They are copied
unchanged from OBS Studio's copy of the SDK
([obsproject/obs-studio](https://github.com/obsproject/obs-studio),
`plugins/decklink/mac/decklink-sdk`, at commit `50530ce9`), under the
permissive licence at the top of each file. Nothing links against Desktop
Video, so Present runs on a Mac without it and says SDI is unavailable.

Playing out needs, on the Mac that runs Present:

- a DeckLink card (in a Thunderbolt enclosure) or an UltraStudio device, and
- Blackmagic Desktop Video, the driver, from Blackmagic's support page.

The SDK's 12.0 interfaces are ones the later Desktop Video releases still
serve.
