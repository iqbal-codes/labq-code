import { createHashRouter } from "react-router";
import { Shell } from "@/components/layout/shell";
import { EnvironmentHome } from "@/components/routes/environment-home";
import { ProjectWorkspace } from "@/components/routes/project-workspace";
import { ThreadWorkspace } from "@/components/routes/thread-workspace";
import { NotFound, RouteErrorBoundary } from "@/components/routes/route-states";

export const router = createHashRouter([
  {
    path: "/",
    element: <Shell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <EnvironmentHome /> },
      { path: "projects/:projectId", element: <ProjectWorkspace /> },
      { path: "projects/:projectId/threads/:threadId", element: <ThreadWorkspace /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
