import { notFound } from "next/navigation";
import { AllCreddyContentBankPage } from "../../all-content-view";

export const dynamic = "force-dynamic";

export default async function AllCreddyContentMediaPage({ params }: { params: Promise<{ media: string }> }) {
  const { media } = await params;
  if (media !== "slideshows" && media !== "videos") notFound();
  return <AllCreddyContentBankPage mediaType={media === "slideshows" ? "slideshow" : "video"} />;
}
