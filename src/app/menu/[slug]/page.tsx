import { PublicMenu } from "@/components/public-menu";
export default async function MenuPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PublicMenu key={slug} slug={slug} />;
}
