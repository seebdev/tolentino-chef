import { Workspace } from "@/components/workspace";
export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Workspace key={id} restaurantId={id} support />;
}
