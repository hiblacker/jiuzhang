// Response shapes shared by several pages. Domain-specific DTOs live next to the page or store
// that owns them until a domain module is extracted.
export interface Project {
  id: number;
  name: string;
  code: string;
  role: 'OWNER' | 'ENGINEER' | 'VIEWER';
}

export interface Identity {
  identity: string;
  platformAdmin: boolean;
  projects: Project[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
