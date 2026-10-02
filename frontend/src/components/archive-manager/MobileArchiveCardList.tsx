import React from 'react';
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Pagination,
  Spin,
  Tag,
  Typography,
  type MenuProps,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { ArchiveEntry } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
import { formatBytes, formatDateParts, formatScore } from './archiveUtils';

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
  onDownloadSource,
  onDeleteArchives,
}) => {
  return (
    <div className="archive-mobile-list" aria-label="服务器归档移动端列表">
      {loading && !allDisplayArchives.length ? (
        <div className="archive-mobile-empty" style={{ padding: '60px 0', textAlign: 'center' }}>
          <Spin size="large" tip="正在载入归档列表..." />
        </div>
      ) : !allDisplayArchives.length ? (
        <div className="archive-mobile-empty-card">
          <Empty description="暂无服务器归档">
            <Button type="primary" onClick={onNavigateToKernels}>前往 Kernel 广场</Button>
          </Empty>
        </div>
      ) : (
        <Spin spinning={loading} tip="正在同步归档列表...">
          <div className="archive-mobile-cards-wrap">
            {archives.map((archive) => {
              const owner = kaggleOwnerFromRef(archive.ref) || archive.author;
              const selected = selectedRowKeys.includes(archive.id);
              const { date, time } = formatDateParts(archive.archived_at);

              const moreMenuItems: MenuProps['items'] = [
                {
                  key: 'delete',
                  danger: true,
                  label: '删除归档',
                  icon: <DeleteOutlined />,
                  onClick: () => onDeleteArchives([archive]),
                },
              ];

              return (
                <article className="archive-mobile-card" key={archive.id}>
                  {/* Tier 1: Checkbox + Title & ref + Version */}
                  <div className="archive-mobile-card-head">
                    <Checkbox
                      checked={selected}
                      aria-label={`选择 ${archive.ref} v${archive.version_number}`}
                      className="archive-mobile-checkbox"
                      onChange={(event) =>
                        setSelectedRowKeys((current) =>
                          event.target.checked
                            ? [...current, archive.id]
                            : current.filter((value) => value !== archive.id),
                        )
                      }
                    />
                    <div className="archive-mobile-card-title-block">
                      <a
                        className="archive-mobile-title"
                        href={kaggleKernelUrl(archive.ref)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {archive.title || archive.ref}
                      </a>
                      <span className="archive-mobile-ref" title={archive.ref}>
                        {archive.ref}
                      </span>
                    </div>
                    <Tag className="archive-version-pill">v{archive.version_number}</Tag>
                  </div>

                  {/* Tier 2: Score + Competition */}
                  <div className="archive-mobile-score-row">
                    <div className="archive-mobile-score-box">
                      <span className="archive-mobile-score-label">公开分</span>
                      <span className="archive-mobile-score-val">
                        {formatScore(archive.public_score)}
                      </span>
                    </div>
                    <span className="archive-mobile-competition" title={archive.competition || '未登记竞赛'}>
                      {archive.competition || '未登记竞赛'}
                    </span>
                  </div>

                  {/* Tier 3: Compact Metadata */}
                  <div className="archive-mobile-meta-block">
                    <div className="archive-mobile-meta-line">
                      <a
                        className="archive-mobile-author"
                        href={kaggleAuthorUrl(owner)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        @{owner}
                      </a>
                      <span className="archive-mobile-meta-dot">·</span>
                      <span className="archive-mobile-files">
                        {archive.file_count || 0} 个文件 · {formatBytes(archive.size_bytes)}
                      </span>
                    </div>
                    <div className="archive-mobile-meta-time">
                      归档于 {date} {time}
                    </div>
                  </div>

                  {/* Tier 4: Primary Actions (详情, 下载, 更多) */}
                  <div className="archive-mobile-actions-row">
                    <Button
                      className="archive-mobile-btn archive-mobile-btn-detail"
                      icon={<EyeOutlined />}
                      onClick={() => onShowDetail(archive)}
                    >
                      详情
                    </Button>
                    <Button
                      className="archive-mobile-btn archive-mobile-btn-download"
                      icon={<DownloadOutlined />}
                      onClick={() => onDownloadSource(archive)}
                    >
                      下载
                    </Button>
                    <Dropdown menu={{ items: moreMenuItems }} trigger={['click']} placement="bottomRight">
                      <Button
                        className="archive-mobile-btn archive-mobile-btn-more"
                        icon={<EllipsisOutlined />}
                        aria-label="更多操作"
                      />
                    </Dropdown>
                  </div>
                </article>
              );
            })}
          </div>

          {allDisplayArchives.length > pageSize && (
            <div className="archive-mobile-footer">
              <Text className="archive-mobile-total">总计 {allDisplayArchives.length} 条</Text>
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
