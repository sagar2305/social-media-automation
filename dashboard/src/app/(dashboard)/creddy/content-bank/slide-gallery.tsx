"use client";

import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type SlideGalleryProps = {
  itemId: string;
  hook: string;
  slideCount: number;
  revision: number;
};

export function SlideGallery({ itemId, hook, slideCount, revision }: SlideGalleryProps) {
  const [activeSlide, setActiveSlide] = useState<number | null>(null);

  useEffect(() => {
    if (activeSlide === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveSlide(null);
      if (event.key === "ArrowLeft") {
        setActiveSlide((current) => current === null ? null : (current - 1 + slideCount) % slideCount);
      }
      if (event.key === "ArrowRight") {
        setActiveSlide((current) => current === null ? null : (current + 1) % slideCount);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeSlide, slideCount]);

  const slideUrl = (index: number) =>
    `/api/creddy/slides/${encodeURIComponent(itemId)}/${index + 1}?revision=${revision}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: slideCount }, (_, index) => (
          <button
            aria-label={`Open slide ${index + 1} of ${slideCount}`}
            className="group space-y-1 text-left"
            key={index}
            onClick={() => setActiveSlide(index)}
            type="button"
          >
            <span className="relative block overflow-hidden rounded-lg border bg-muted">
              <Image
                alt={`${hook} — slide ${index + 1}`}
                className="aspect-[3/4] w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                height={1440}
                src={slideUrl(index)}
                unoptimized
                width={1080}
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                <span className="flex items-center gap-1 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  <Expand className="size-3.5" /> Open image
                </span>
              </span>
            </span>
            <span className="block text-center text-xs text-muted-foreground">Slide {index + 1}</span>
          </button>
        ))}
      </div>

      {activeSlide !== null && (
        <div
          aria-label={`Slide ${activeSlide + 1} preview`}
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setActiveSlide(null)}
          role="dialog"
        >
          <div className="absolute left-4 top-4 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white">
            Slide {activeSlide + 1} of {slideCount} · 1080×1440
          </div>
          <Button
            aria-label="Close image preview"
            className="absolute right-4 top-4 rounded-full text-white hover:bg-white/20 hover:text-white"
            onClick={() => setActiveSlide(null)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-6" />
          </Button>
          <Button
            aria-label="Previous slide"
            className="absolute left-3 rounded-full text-white hover:bg-white/20 hover:text-white sm:left-8"
            onClick={(event) => {
              event.stopPropagation();
              setActiveSlide((activeSlide - 1 + slideCount) % slideCount);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft className="size-8" />
          </Button>
          <Image
            alt={`${hook} — slide ${activeSlide + 1} enlarged`}
            className="max-h-[92vh] max-w-[86vw] rounded-lg object-contain shadow-2xl"
            height={1440}
            onClick={(event) => event.stopPropagation()}
            src={slideUrl(activeSlide)}
            unoptimized
            width={1080}
          />
          <Button
            aria-label="Next slide"
            className="absolute right-3 rounded-full text-white hover:bg-white/20 hover:text-white sm:right-8"
            onClick={(event) => {
              event.stopPropagation();
              setActiveSlide((activeSlide + 1) % slideCount);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight className="size-8" />
          </Button>
        </div>
      )}
    </>
  );
}
