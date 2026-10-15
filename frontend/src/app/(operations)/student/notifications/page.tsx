import type { Metadata } from "next";

import { NotificationCenter } from "@/components/notifications/notification-center";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Notifications" };

export default function StudentNotificationsPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {() => (
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <NotificationCenter />
        </main>
      )}
    </ProtectedArea>
  );
}
