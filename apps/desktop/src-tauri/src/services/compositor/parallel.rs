//! Spreading the per-pixel passes across cores.
//!
//! The compositor's two hot loops — turning a decoded video frame into premul-
//! tiplied pixels, and blending the slide over it — are each two million
//! independent pixels. They were running on one core of twelve, which is where
//! most of a 23 ms composite was going.
//!
//! Rows are independent, so the work splits by simply cutting the pixel slice
//! into bands. No locking, no sharing, no ordering: each band writes only its
//! own pixels.
//!
//! `std::thread::scope` rather than a pool or a dependency. A scope costs a
//! spawn per band per frame, which at twelve bands and thirty frames a second
//! is a few hundred spawns — tens of microseconds against a budget of
//! thirty-three thousand. A pool would be tidier and is not yet worth a crate.

/// How many bands to cut the work into.
///
/// One per core, capped so a many-core machine does not spend more on spawning
/// than on pixels, and floored at one so the logic holds on a single core.
pub(super) fn bands() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .clamp(1, 12)
}

/// Rows below this and the threads cost more than they save.
///
/// A 1920-wide frame is about 2000 pixels a row, so this is roughly 128 000
/// pixels — comfortably above the point where a spawn pays for itself, and far
/// below a full frame.
const MINIMUM_PARALLEL_PIXELS: usize = 128 * 1024;

/// Run `work` over `destination` in parallel bands.
///
/// `work` receives each band and the index of its first pixel, so a caller that
/// needs to know where it is in the image still can.
pub fn for_each_band<T, F>(destination: &mut [T], work: F)
where
    T: Send,
    F: Fn(&mut [T], usize) + Sync,
{
    let total = destination.len();
    let bands = bands();

    if bands <= 1 || total < MINIMUM_PARALLEL_PIXELS {
        work(destination, 0);
        return;
    }

    // Round up so the last band is the short one rather than there being an
    // extra band of one pixel.
    let band = total.div_ceil(bands);

    std::thread::scope(|scope| {
        for (index, chunk) in destination.chunks_mut(band).enumerate() {
            let work = &work;
            scope.spawn(move || work(chunk, index * band));
        }
    });
}

/// Run `work` over a source and destination of the same length, in parallel.
///
/// The pairing is the common shape: read one pixel, write the matching one.
pub fn zip_bands<S, D, F>(source: &[S], destination: &mut [D], work: F)
where
    S: Sync,
    D: Send,
    F: Fn(&[S], &mut [D]) + Sync,
{
    if source.len() != destination.len() {
        return;
    }

    let total = destination.len();
    let bands = bands();

    if bands <= 1 || total < MINIMUM_PARALLEL_PIXELS {
        work(source, destination);
        return;
    }

    let band = total.div_ceil(bands);

    std::thread::scope(|scope| {
        for (source_chunk, destination_chunk) in
            source.chunks(band).zip(destination.chunks_mut(band))
        {
            let work = &work;
            scope.spawn(move || work(source_chunk, destination_chunk));
        }
    });
}

/// Run `work` over pixels and a byte buffer holding `bytes_per_pixel` bytes for
/// each of them, in parallel bands that never cut a pixel in half.
///
/// For converting between a pixel type and packed bytes, where source and
/// destination differ in length and `zip_bands` would misalign them.
pub fn zip_pixel_bands<S, F>(source: &[S], destination: &mut [u8], bytes_per_pixel: usize, work: F)
where
    S: Sync,
    F: Fn(&[S], &mut [u8]) + Sync,
{
    if bytes_per_pixel == 0 || source.len().checked_mul(bytes_per_pixel) != Some(destination.len())
    {
        return;
    }

    let total = source.len();
    let bands = bands();

    if bands <= 1 || total < MINIMUM_PARALLEL_PIXELS {
        work(source, destination);
        return;
    }

    let band = total.div_ceil(bands);

    std::thread::scope(|scope| {
        for (source_chunk, destination_chunk) in source
            .chunks(band)
            .zip(destination.chunks_mut(band * bytes_per_pixel))
        {
            let work = &work;
            scope.spawn(move || work(source_chunk, destination_chunk));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixel_bands_never_cut_a_pixel_in_half() {
        // A band boundary inside a pixel would pair one pixel's source with
        // another's bytes — every band after the first shifted by a channel.
        let length = MINIMUM_PARALLEL_PIXELS * 2 + 5;
        let source: Vec<u32> = (0..length as u32).collect();
        let mut destination = vec![0u8; length * 4];

        zip_pixel_bands(&source, &mut destination, 4, |pixels, bytes| {
            for (pixel, slot) in pixels.iter().zip(bytes.chunks_exact_mut(4)) {
                slot.copy_from_slice(&pixel.to_le_bytes());
            }
        });

        assert!(
            destination
                .chunks_exact(4)
                .enumerate()
                .all(
                    |(index, bytes)| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
                        == index as u32
                ),
            "a pixel landed in another pixel's bytes"
        );
    }

    #[test]
    fn pixel_bands_refuse_a_buffer_of_the_wrong_size() {
        let source = vec![1u32; 10];
        let mut destination = vec![0u8; 39];

        zip_pixel_bands(&source, &mut destination, 4, |_, _| {
            panic!("should not run")
        });
        assert!(destination.iter().all(|value| *value == 0));
    }

    #[test]
    fn every_element_is_visited_exactly_once() {
        // The failure that would matter: a band boundary that skips or repeats
        // pixels, which shows up as a torn line across the audience screen.
        let mut values = vec![0u32; MINIMUM_PARALLEL_PIXELS * 2 + 7];
        for_each_band(&mut values, |band, _| {
            for value in band.iter_mut() {
                *value += 1;
            }
        });

        assert!(
            values.iter().all(|value| *value == 1),
            "a pixel was missed or repeated"
        );
    }

    #[test]
    fn the_offset_identifies_where_a_band_starts() {
        let length = MINIMUM_PARALLEL_PIXELS * 2;
        let mut values = vec![0usize; length];
        for_each_band(&mut values, |band, offset| {
            for (index, value) in band.iter_mut().enumerate() {
                *value = offset + index;
            }
        });

        assert!(
            values
                .iter()
                .enumerate()
                .all(|(index, value)| index == *value),
            "band offsets do not reconstruct the original order"
        );
    }

    #[test]
    fn a_small_slice_runs_inline_and_still_completes() {
        let mut values = vec![0u32; 16];
        for_each_band(&mut values, |band, _| {
            for value in band.iter_mut() {
                *value = 9;
            }
        });
        assert!(values.iter().all(|value| *value == 9));
    }

    #[test]
    fn an_empty_slice_does_not_panic() {
        // A frame with no pixels is degenerate, not a crash. The work runs once
        // over nothing, which is the cheapest correct answer.
        // The closure has to be `Fn` because bands share it across threads, so
        // the count goes through an atomic rather than a captured local.
        use std::sync::atomic::{AtomicUsize, Ordering};

        let mut values: Vec<u32> = Vec::new();
        let bands_seen = AtomicUsize::new(0);
        for_each_band(&mut values, |band, _| {
            assert!(band.is_empty());
            bands_seen.fetch_add(1, Ordering::Relaxed);
        });
        assert_eq!(bands_seen.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn zipped_bands_stay_aligned() {
        // Misaligned bands would read one pixel and write another, which is a
        // sheared image rather than an obvious crash.
        let length = MINIMUM_PARALLEL_PIXELS * 2 + 13;
        let source: Vec<usize> = (0..length).collect();
        let mut destination = vec![0usize; length];

        zip_bands(&source, &mut destination, |source, destination| {
            for (from, to) in source.iter().zip(destination.iter_mut()) {
                *to = *from * 2;
            }
        });

        assert!(
            destination
                .iter()
                .enumerate()
                .all(|(index, value)| *value == index * 2),
            "source and destination bands drifted apart"
        );
    }

    #[test]
    fn mismatched_lengths_do_nothing_rather_than_half_a_frame() {
        let source = vec![1u8; 10];
        let mut destination = vec![0u8; 11];

        zip_bands(&source, &mut destination, |_, _| panic!("should not run"));
        assert!(destination.iter().all(|value| *value == 0));
    }
}
