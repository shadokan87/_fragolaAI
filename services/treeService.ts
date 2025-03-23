import dirTree from 'directory-tree';

interface custom {
  fullPath: string
}

export interface TreeResult<T = custom> {
  name: string,
  path: string,
  type: "file" | "directory",
  custom: T,
  children?: TreeResult[]
}

export class TreeService {
  constructor(private cwd: string = process.env.PWD!) { }

  setCwd(path: string): TreeService {
    this.cwd = path;
    return this;
  }

  async list(): Promise<TreeResult> {
    const filteredTree = dirTree(this.cwd, { exclude: [/node_modules/], attributes: ['type'] }, (item) => {
      item.custom = { fullPath: item.path }
      item.path = item.path.slice(this.cwd.length);
    }, (dir) => {
      dir.path = dir.path.slice(this.cwd.length);
      dir.path = dir.path == "" ? "/" : dir.path;
    });
    return filteredTree as unknown as TreeResult;
  }
}