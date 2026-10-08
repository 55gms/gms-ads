import { useRouteLoaderData } from 'react-router';

// The signed-in user and public config, loaded once by the root route.
export const useSession = () => useRouteLoaderData('root');

// Owners and admins can change things; viewers are read-only.
export const useCanWrite = () => ['owner', 'admin'].includes(useSession()?.user.role);
