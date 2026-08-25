"use client";

import Image from "next/image";
import { ImageIcon, Palette, RefreshCw, Smile, Type } from "lucide-react";
import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CREDDY_BACKGROUND_STYLES,
  CREDDY_EXPRESSIONS,
  CREDDY_PHONE_TEMPLATES,
  type CreddySlideEditor,
  type CreddySlideEditorScene,
  type CreddyPhoneTemplate,
} from "@/lib/creddy-slide-options";
import { updateCreddySlideshowDesignAction } from "./actions";

function expressionLabel(expression: (typeof CREDDY_EXPRESSIONS)[number]) {
  return expression.replace(/^\d{3}-/, "").split("-").map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}

const phoneLabels: Record<(typeof CREDDY_PHONE_TEMPLATES)[number], string> = {
  wallet_vouchers: "Wallet & vouchers",
  spend_goals: "Spend goals",
  app_store_dark: "App Store · dark",
  app_store_light: "App Store · light",
};

const backgroundColors: Record<(typeof CREDDY_BACKGROUND_STYLES)[number], string | undefined> = {
  spotlight: undefined,
  deep_navy: "rgba(10, 23, 48, 0.92)",
  forest: "rgba(11, 36, 27, 0.92)",
  burgundy: "rgba(50, 16, 23, 0.92)",
};

function headlineSize(text: string) {
  if (text.length > 125) return "text-[10px]";
  if (text.length > 90) return "text-[11px]";
  if (text.length > 60) return "text-[13px]";
  if (text.length > 38) return "text-[15px]";
  return "text-[18px]";
}

function LiveSlidePreview({
  hook,
  scene,
  slide,
  phoneTemplate,
}: {
  hook: string;
  scene: CreddySlideEditorScene;
  slide: number;
  phoneTemplate: CreddyPhoneTemplate;
}) {
  const isAppSlide = slide === 6;
  const assetUrl = isAppSlide
    ? `/api/creddy/editor-assets/phone/${phoneTemplate}`
    : `/api/creddy/editor-assets/expression/${scene.expression}`;
  const tint = backgroundColors[scene.backgroundStyle];

  return (
    <div>
      <div
        aria-label={`Live preview of slide ${slide}`}
        aria-live="polite"
        className="relative aspect-[3/4] w-32 overflow-hidden rounded-lg border bg-black shadow-sm"
      >
        <Image
          alt={`Live preview of slide ${slide} of ${hook}`}
          className="object-cover"
          fill
          sizes="128px"
          src={assetUrl}
          unoptimized
        />
        {tint && <div className="absolute left-0 top-0 z-10 h-[58%] w-[61%]" style={{ backgroundColor: tint }} />}
        <div className="absolute left-[2%] top-[4.8%] z-20 h-px w-[50%] bg-[#c99625]">
          <span className="absolute -right-1.5 -top-1 block size-2 rotate-45 bg-[#c99625]" />
        </div>
        <div
          className={`absolute left-[5%] top-[7.5%] z-20 w-[47%] whitespace-pre-wrap break-words uppercase leading-[0.88] text-[#f5ebdd] drop-shadow-md ${headlineSize(scene.text)}`}
          style={{ fontFamily: "CreddyHeadlinePreview, Impact, sans-serif" }}
        >
          {scene.text || "Your headline"}
        </div>
        {!isAppSlide && (
          <div className="absolute left-[5%] top-[59%] z-20 flex h-[12%] w-[37%] items-center bg-[#f5ebdd] px-[4%] text-[6px] leading-tight text-[#090806]">
            <span style={{ fontFamily: "CreddyCardPreview, sans-serif" }}>{scene.supportText || "Supporting text"}</span>
            <span className="absolute bottom-0 right-0 h-1/3 w-0.5 bg-[#c99625]" />
          </div>
        )}
      </div>
      <div className="mt-2 text-center text-xs font-medium text-muted-foreground">Slide {slide} · Live</div>
    </div>
  );
}

export function SlideshowSlideEditor({
  id,
  hook,
  revision,
  editor,
}: {
  id: string;
  hook: string;
  revision: number;
  editor: CreddySlideEditor;
}) {
  const [scenes, setScenes] = useState(() => editor.scenes.map((scene) => ({ ...scene })));
  const [phoneTemplate, setPhoneTemplate] = useState<CreddyPhoneTemplate>(editor.phoneTemplateId);
  const [actionState, formAction, isPending] = useActionState(updateCreddySlideshowDesignAction, {});

  function updateScene(index: number, patch: Partial<CreddySlideEditorScene>) {
    setScenes((current) => current.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene));
  }

  return (
    <details className="rounded-xl border border-emerald-200 bg-muted/20 dark:border-emerald-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl bg-emerald-600 p-4 font-semibold text-white transition-colors hover:bg-emerald-700 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2"><Palette className="size-4" />Edit slide design</span>
        <Badge className="border-white/40 bg-white/15 text-white hover:bg-white/20" variant="outline">{editor.editable ? "Canva-style controls" : "Editing locked"}</Badge>
      </summary>
      <div className="border-t p-4">
        <style>{`
          @font-face { font-family: CreddyHeadlinePreview; src: url('/api/creddy/editor-assets/font/headline') format('truetype'); font-display: swap; }
          @font-face { font-family: CreddyCardPreview; src: url('/api/creddy/editor-assets/font/card') format('truetype'); font-display: swap; }
        `}</style>
        <p className="text-sm text-muted-foreground">Change the on-image copy, supporting text, Creddy emotion, and final app screen. Saving regenerates all six 1080×1440 images with overflow and overlap checks.</p>
        {editor.editable && <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">Live preview is on — every change appears on the slide thumbnail instantly.</p>}
        {!editor.editable ? (
          <div className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm">
            <strong>Design editing is protected.</strong> <span className="text-muted-foreground">{editor.blockedReason}</span>
          </div>
        ) : (
          <form action={formAction} className="mt-5 space-y-5">
            <input name="id" type="hidden" value={id} />
            <div className="grid gap-4 xl:grid-cols-2">
              {scenes.map((scene, index) => {
                const slide = index + 1;
                const isAppSlide = index === 5;
                return (
                  <fieldset className="grid gap-4 rounded-xl border bg-background p-4 sm:grid-cols-[128px_1fr]" key={slide}>
                    <div>
                      <LiveSlidePreview hook={hook} phoneTemplate={phoneTemplate} scene={scene} slide={slide} />
                    </div>
                    <div className="space-y-3">
                      <label className="block space-y-1.5 text-sm font-medium">
                        <span className="flex items-center gap-2"><Type className="size-4" />On-image headline</span>
                        <textarea className="min-h-24 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={220} name={`slide_${slide}_text`} onInput={(event) => updateScene(index, { text: event.currentTarget.value })} required value={scene.text} />
                      </label>
                      {!isAppSlide && <label className="block space-y-1.5 text-sm font-medium">
                        <span>Supporting card text</span>
                        <input className="h-10 w-full rounded-md border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={70} name={`slide_${slide}_support`} onInput={(event) => updateScene(index, { supportText: event.currentTarget.value })} required value={scene.supportText} />
                      </label>}
                      {isAppSlide
                        ? <>
                          <input name={`slide_${slide}_support`} type="hidden" value="" />
                          <input name={`slide_${slide}_expression`} type="hidden" value={scene.expression} />
                          <label className="block space-y-1.5 text-sm font-medium">
                            <span className="flex items-center gap-2"><ImageIcon className="size-4" />Real Creddy app screen</span>
                            <select className="h-10 w-full rounded-md border bg-background px-3 font-normal" name="phone_template" onInput={(event) => setPhoneTemplate(event.currentTarget.value as CreddyPhoneTemplate)} value={phoneTemplate}>
                              {CREDDY_PHONE_TEMPLATES.map((template) => <option key={template} value={template}>{phoneLabels[template]}</option>)}
                            </select>
                          </label>
                        </>
                        : <label className="block space-y-1.5 text-sm font-medium">
                          <span className="flex items-center gap-2"><Smile className="size-4" />Creddy expression</span>
                          <select className="h-10 w-full rounded-md border bg-background px-3 font-normal" name={`slide_${slide}_expression`} onInput={(event) => updateScene(index, { expression: event.currentTarget.value as CreddySlideEditorScene["expression"] })} value={scene.expression}>
                            {CREDDY_EXPRESSIONS.map((expression) => <option key={expression} value={expression}>{expressionLabel(expression)}</option>)}
                          </select>
                        </label>}
                      <input name={`slide_${slide}_background`} type="hidden" value={scene.backgroundStyle} />
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="rounded-lg border bg-background p-4">
              {actionState.error && <p className="mb-3 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{actionState.error}</p>}
              <Button disabled={isPending} type="submit"><RefreshCw className={isPending ? "size-4 animate-spin" : "size-4"} />{isPending ? "Regenerating slides…" : "Save and regenerate slides"}</Button>
              <p className="mt-2 text-xs text-muted-foreground">Creates revision {revision + 1}, preserves the previous images, invalidates old uploaded-media URLs, and returns the post to human review. No image-generation credits are used.</p>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
