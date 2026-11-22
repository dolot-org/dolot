const defaultRepository = 'https://github.com/dolot-org/dolot';
const githubRepository = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;

export function sourceLinks(repository?: string, revision?: string) {
  const repo = repository?.replace(/\/$/, '') ?? defaultRepository;
  const base = githubRepository.test(repo) ? repo : defaultRepository;
  const ref = revision && /^[a-f0-9]{40}$/.test(revision) ? revision : 'main';
  return {
    repository: base,
    tree: `${base}/tree/${ref}`,
    archive: `${base}/archive/${ref}.tar.gz`,
    license: `${base}/blob/${ref}/LICENSE`,
    commit: ref === 'main' ? null : ref,
  };
}
