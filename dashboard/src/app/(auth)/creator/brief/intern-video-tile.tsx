"use client";

/**
 * InternVideoTile — click-to-load YouTube embed used inside the brief
 * page's intern-showcase grid.
 *
 * Why a custom wrapper instead of a bare <iframe>:
 *   • On mobile, the default YouTube embed sometimes leaves the user
 *     with no obvious way to stop the video. Showing the iframe only
 *     after an explicit tap (and adding an explicit × close button)
 *     gives the visitor a clear "stop the video" affordance.
 *   • Defers the iframe load until interaction, which speeds up the
 *     brief page's first paint when several intern tiles are present.
 *
 * The placeholder uses YouTube's own thumbnail (`/hqdefault.jpg`) so
 * we don't have to ship any extra image with the deploy.
 */

import { useState } from "react";
import { Play, X } from "lucide-react";

export function InternVideoTile({
  youtubeId,
  title,
}: {
  youtubeId: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative aspect-[9/16] w-full rounded-lg overflow-hidden bg-black">
      {loaded ? (
        <>
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0`}
            className="absolute inset-0 w-full h-full"
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
          <button
            type="button"
            onClick={() => setLoaded(false)}
            aria-label="Stop video"
            className="absolute top-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm shadow-lg ring-1 ring-white/20 hover:bg-black/80 transition-colors"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          aria-label={`Play ${title}`}
          className="group absolute inset-0 w-full h-full flex items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <span
            aria-hidden
            className="relative z-10 inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-brand-700 shadow-xl ring-1 ring-white/40 group-hover:scale-105 transition-transform"
          >
            <Play className="h-6 w-6 fill-current ml-0.5" />
          </span>
        </button>
      )}
    </div>
  );
}
