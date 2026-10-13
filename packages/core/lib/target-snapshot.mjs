// Build the immutable brand-target snapshot stored with each monitoring run.
// This stays dependency-free so both the core Worker and Cloud preview tooling
// use the same target semantics without crossing the edition boundary.
export function buildTargetSnapshot(project) {
  return [
    {
      name: project.name,
      domain: project.domain,
      aliases: JSON.parse(project.aliases_json || '[]'),
      domains: [
        project.domain,
        ...JSON.parse(project.additional_domains_json || '[]'),
      ],
    },
    ...JSON.parse(project.competitors_json || '[]'),
  ];
}
