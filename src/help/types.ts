export interface HelpSection {
  id: string;
  title: string;
  content: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  shortDesc: string;
  sections: HelpSection[];
}

export interface SearchResult {
  topicId: string;
  sectionId: string;
  lineIndex: number;
  matchStart: number;
  matchEnd: number;
}
