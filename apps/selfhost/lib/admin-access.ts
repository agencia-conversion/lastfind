/** The independent edition has one owner, who installed it: signed in, the owner is the admin of the installation. */
export const isAdmin = (user: { email: string } | null | undefined) => !!user;
