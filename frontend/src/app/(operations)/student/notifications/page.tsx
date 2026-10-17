import type { Metadata } from "next";

import { NotificationCenter } from "@/components/notifications/notification-center";
import { PushSettings } from "@/components/notifications/push-settings";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Notifications" };

export default function StudentNotificationsPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => (
        <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6">
          <PushSettings userId={user.id} />
          <NotificationCenter />
        </main>
      )}
    </ProtectedArea>
  );
}
