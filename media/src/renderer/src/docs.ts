// 탭(doc) 종류별 속성 정의. 열기/닫기 동작은 이 속성으로 결정된다.
export interface DocType {
  multi: boolean // 여러 개를 독립적으로 열 수 있나? (false 면 기존 탭으로 이동)
  editable: boolean // 편집/저장 개념이 있나?
  watch: boolean // 외부 수정 감지를 위해 파일을 watch 하나? (파일 기반 doc 만 true)
  // editable 이고 변경(dirty)된 채 닫을 때:
  //  - 'save'    : 저장 후 닫기
  //  - 'discard' : 그냥 닫기
  //  - 'notify'  : 저장하지 않고 닫되, 알림(Save 액션 포함)으로 알린다
  closeDirty: 'save' | 'discard' | 'notify'
}

export const doc_types: Record<string, DocType> = {
  musicSearch: { multi: true, editable: false, watch: false, closeDirty: 'discard' },
  youtubeSearch: { multi: true, editable: false, watch: false, closeDirty: 'discard' },
  editor: { multi: false, editable: true, watch: true, closeDirty: 'notify' }
}

const fallback: DocType = { multi: true, editable: false, watch: false, closeDirty: 'discard' }

export function resolve_doc_type(kind: 'feature' | 'editor', iconId?: string): DocType {
  if (kind === 'editor') {
    return doc_types.editor
  }
  return (iconId && doc_types[iconId]) || fallback
}
