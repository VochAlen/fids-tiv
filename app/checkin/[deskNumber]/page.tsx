// app/checkin/[deskNumber]/page.tsx — zamijeni sadržaj sa redirectom
import { redirect } from 'next/navigation';

export default function LegacyCheckInRedirect({
  params,
}: {
  params: { deskNumber: string };
}) {
  redirect(`/ver2/ver2/checkin/${params.deskNumber}`);
}