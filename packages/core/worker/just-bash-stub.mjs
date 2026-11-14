// The agent SDK's skill script runner imports just-bash (an optional dependency) for Bash skill scripts. Lastfind's
// skills carry no scripts and never run one, so the Worker gets this stand-in instead of a shell interpreter.
export class Bash {
  constructor() {
    throw new Error('Skill scripts do not run in Lastfind.');
  }
}
export const defineCommand = () => {
  throw new Error('Skill scripts do not run in Lastfind.');
};
