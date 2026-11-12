/** What an account is called on its tab, in Settings and in the password pill. */
const localPart = (email: string) => email.split('@')[0].toLowerCase();

/**
 * The tab name set in Settings; else the part before the @, unless two such accounts share it:
 * then the whole address for those two.
 */
export function tabLabel(account: { email: string; tabName: string | null }, all: { email: string; tabName: string | null }[]): string {
    if (account.tabName) return account.tabName;
    const shared = all.filter(a => !a.tabName && localPart(a.email) === localPart(account.email)).length > 1;
    return shared ? account.email : account.email.split('@')[0];
}
