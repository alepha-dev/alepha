import AdminJobDetail from "@alepha/ui/components/admin/admin-job-detail";

/**
 * Mounted at `/admin/jobs/:jobName` under the route name `jobDetail`, which
 * is what `AdminJobs` pushes.
 *
 * `backPath` has to be passed: it defaults to `/admin/jobs`, `AdminRouter`'s
 * list page, which does not exist here.
 *
 * Rendered bare, without a `Showcase`, like the user detail page: this is the
 * destination of a link inside another component.
 */
const JobDetail = () => <AdminJobDetail backPath="/pages/admin/jobs" />;

export default JobDetail;
