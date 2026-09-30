import React from 'react';
import { Button, Checkbox, Empty, Pagination, Spin, Tag, Tooltip, Typography } from 'antd';
import {
  CodeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ArchiveEntry } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
import { formatBytes, formatDate, formatScore } from './archiveUtils';

const { Text } = Typography;

interface MobileArchiveCardListProps {
  archives: ArchiveEntry[];
  allDisplayArchives: ArchiveEntry[];
  loading: boolean;
  selectedRowKeys: React.Key[];
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  mobilePage: number;
  pageSize: number;
  setMobilePage: (page: number) => void;
  onNavigateToKernels: () => void;
  onShowDetail: (archive: ArchiveEntry) => void;
  onOpenVsCode: (archive: ArchiveEntry) => void;
  onOpenFolder: (archive: ArchiveEntry) => void;
  onDownloadSource: (archive: ArchiveEntry) => void;
  onDeleteArchives: (archives: ArchiveEntry[]) => void;
}

export const MobileArchiveCardList: React.FC<MobileArchiveCardListProps> = ({
  archives,
  allDisplayArchives,
  loading,
  selectedRowKeys,
  setSelectedRowKeys,
  mobilePage,
  pageSize,
  setMobilePage,
  onNavigateToKernels,
  onShowDetail,
  onOpenVsCode,
  onOpenFolder,
  onDownloadSource,
  onDeleteArchives,
}) => {
  return (
    <div className="mobile-data-list" aria-label="本地归档列表">
      {loading && !allDisplayArchives.length ? (
        <div className="mobile-empty-state" style={{ padding: '60px 0', textAlign: 'center' }}>
          <Spin size="large" tip="正在载入归档列表..." />
        </div>
      ) : !allDisplayArchives.length ? (
        <Empty description="暂无本地归档">
          <Button type="primary" onClick={onNavigateToKernels}>前往 Kernel 广场</Button>
        </Empty>
      ) : (
        <Spin spinning={loading} tip="正在同步归档列表...">
      {archives.map((archive) => {
        const owner = kaggleOwnerFromRef(archive.ref) || archive.author;
        const selected = selectedRowKeys.includes(archive.id);
        return (
          <article className="mobile-data-card" key={archive.id}>
            <div className="mobile-data-card-head">
              <Checkbox
                checked={selected}
                aria-label={`选择 ${archive.ref} v${archive.version_number}`}
                onChange={(event) =>
                  setSelectedRowKeys((current) =>
                    event.target.checked
                      ? [...current, archive.id]
                      : current.filter((value) => value !== archive.id),
                  )
                }
              />
              <div className="mobile-data-card-title">
                <a className="kernel-title" href={kaggleKernelUrl(archive.ref)} target="_blank" rel="noreferrer">
                  {archive.title || archive.ref}
                </a>
                <span className="kernel-ref">{archive.ref}</span>
              </div>
              <Tag color="blue">v{archive.version_number}</Tag>
            </div>
            <div className="mobile-data-card-meta">
              <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">
                <UserOutlined /> @{owner}
              </a>
              <span>{archive.competition || '未登记竞赛'}</span>
              <span className="score-value">
                分数 {formatScore(archive.public_score)}
              </span>
              <span>{archive.file_count || 0} 个文件 · {formatBytes(archive.size_bytes)}</span>
              <span>{formatDate(archive.archived_at)}</span>
            </div>
            <div className="mobile-data-card-actions">
              <Button icon={<EyeOutlined />} onClick={() => onShowDetail(archive)}>详情</Button>
              <Tooltip title="在 VS Code 中打开">
                <Button icon={<CodeOutlined />} aria-label="在 VS Code 中打开" onClick={() => onOpenVsCode(archive)} />
              </Tooltip>
              <Tooltip title="打开归档目录">
                <Button icon={<FolderOpenOutlined />} aria-label="打开归档目录" onClick={() => onOpenFolder(archive)} />
              </Tooltip>
              <Tooltip title="下载源文件">
                <Button icon={<DownloadOutlined />} aria-label="下载源文件" onClick={() => onDownloadSource(archive)} />
              </Tooltip>
              <Tooltip title="删除归档">
                <Button danger icon={<DeleteOutlined />} aria-label="删除归档" onClick={() => onDeleteArchives([archive])} />
              </Tooltip>
            </div>
          </article>
        );
      })}
      {allDisplayArchives.length > pageSize && (
        <div className="mobile-list-footer">
          <Text type="secondary">总计：{allDisplayArchives.length}</Text>
          <Pagination
            simple
            size="small"
            current={mobilePage}
            pageSize={pageSize}
            total={allDisplayArchives.length}
            showSizeChanger={false}
            onChange={setMobilePage}
          />
        </div>
      )}
        </Spin>
      )}
    </div>
  );
};

export default MobileArchiveCardList;
