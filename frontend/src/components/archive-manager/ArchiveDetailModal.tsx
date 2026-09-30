import React, { useState } from 'react';
import {
  Alert,
  Button,
  Modal,
  Spin,
  Table,
  Typography,
} from 'antd';
import {
  DownloadOutlined,
} from '@ant-design/icons';
import { Archive } from 'lucide-react';
import type { ArchiveEntry, ArchiveFile } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
import { ArchiveStudyPanel } from './ArchiveStudyPanel';
import type { ArchiveStudy } from '../../archiveStudyApi';
import CopyButton from '../CopyButton';
import DialogTitle from '../DialogTitle';
import {
  type ArchiveMetadata,
  DetailField,
  formatBytes,
  formatDate,
  formatScore,
  metadataValue,
  normalizeBoolean,
  normalizeEnumLabel,
  normalizeMachineShape,
  sourceLink,
} from './archiveUtils';

const { Text } = Typography;

interface ArchiveDetailModalProps {
  archives: ArchiveEntry[];
  onStudySaved: (id: string, study: ArchiveStudy) => void;
  open: boolean;
  onClose: () => void;
  archive: ArchiveEntry | null;
  metadata: ArchiveMetadata | null;
  files: ArchiveFile[];
  loading: boolean;
  error: string | null;
  onDownloadSource: (archive: ArchiveEntry) => void;
}

export const ArchiveDetailModal: React.FC<ArchiveDetailModalProps> = ({
  open,
  archives,
  onStudySaved,
  onClose,
  archive,
  metadata: detailMetadata,
  files: detailFiles,
  loading,
  error,
  onDownloadSource,
}) => {
  const [dirty, setDirty] = useState(false);
  const close = () => {
    if (!dirty) { onClose(); return; }
    Modal.confirm({ title: '研究记录尚未保存', content: '关闭后将丢弃未保存的修改。', okText: '丢弃并关闭', cancelText: '继续编辑', onOk: () => { setDirty(false); onClose(); } });
  };
  const metadata = detailMetadata?.metadata;
  const inputs = detailMetadata?.input_sources;
  const gpuEnabled = normalizeBoolean(
    metadataValue(metadata, 'enableGpu', 'enable_gpu', 'isGpuEnabled'),
  );
  const internetEnabled = normalizeBoolean(
    metadataValue(metadata, 'enableInternet', 'enable_internet', 'isInternetEnabled'),
  );
  const machineShape = normalizeMachineShape(
    metadataValue(metadata, 'machineShape', 'machine_shape', 'acceleratorType'),
  );

  return (
    <Modal
      className="app-modal archive-detail-modal"
      title={(
        <DialogTitle
          icon={<Archive size={18} color="#007aff" />}
          title="归档详情"
          subtitle={archive ? `${archive.ref} · v${archive.version_number}` : undefined}
          onClose={close}
        />
      )}
      open={open}
      closable={false}
      destroyOnClose
      width={880}
      onCancel={close}
      footer={
        <div className="archive-modal-footer">
          {archive && (
            <div className="archive-modal-footer-actions">
              <Button
                className="archive-modal-btn archive-modal-btn-download"
                icon={<DownloadOutlined />}
                onClick={() => onDownloadSource(archive)}
              >
                下载源文件
              </Button>
            </div>
          )}
          <Button
            type="primary"
            className="archive-modal-btn archive-modal-btn-close"
            onClick={close}
          >
            关闭
          </Button>
        </div>
      }
    >
      {loading ? (
        <div style={{ display: 'grid', minHeight: 240, placeItems: 'center' }}>
          <Spin tip="正在载入归档详情..." />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message="详情加载失败" description={error} />
      ) : archive ? (
        <div className="archive-detail-body">
          <ArchiveStudyPanel key={archive.id} archive={archive} archives={archives} onSaved={onStudySaved} onDirtyChange={setDirty} />
          <div className="archive-detail-grid" aria-label="归档基础信息">
            <DetailField label="Kernel">
              <div className="archive-detail-copy-wrap">
                <a
                  className="archive-detail-link"
                  href={kaggleKernelUrl(archive.ref)}
                  target="_blank"
                  rel="noreferrer"
                  title={archive.ref}
                >
                  {archive.ref}
                </a>
                <CopyButton value={archive.ref} label="复制 Kernel ref" />
              </div>
            </DetailField>

            <DetailField label="作者">
              <a
                className="archive-detail-link"
                href={kaggleAuthorUrl(
                  kaggleOwnerFromRef(archive.ref) || archive.author,
                )}
                target="_blank"
                rel="noreferrer"
              >
                @{kaggleOwnerFromRef(archive.ref) || archive.author}
              </a>
            </DetailField>

            <DetailField label="竞赛">
              <span className="archive-detail-text">{archive.competition || '未登记'}</span>
            </DetailField>

            <DetailField label="公开分数">
              <span className="archive-detail-score">{formatScore(archive.public_score)}</span>
            </DetailField>

            <DetailField label="归档时间">
              <span className="archive-detail-text">{formatDate(archive.archived_at)}</span>
            </DetailField>

            <DetailField label="包含输出">
              {archive.include_outputs ? (
                <span className="archive-soft-tag tag-success">已包含输出</span>
              ) : (
                <span className="archive-soft-tag tag-neutral">未包含</span>
              )}
            </DetailField>

            <DetailField label="保存路径" wide>
              <div className="archive-path-row">
                <Text className="archive-path-text" title={archive.path}>
                  {archive.path}
                </Text>
                <div className="archive-path-copy">
                  <CopyButton value={archive.path} label="复制保存路径" />
                </div>
              </div>
            </DetailField>
          </div>

          {(inputs?.dataset_sources?.length || inputs?.kernel_sources?.length || inputs?.competition_sources?.length) ? (
            <section className="detail-section">
              <h3 className="detail-section-title">输入依赖</h3>
              <div className="archive-sources-wrap">
                {inputs.dataset_sources?.map((source) => (
                  <a key={`dataset-${source}`} href={sourceLink('dataset', source)} target="_blank" rel="noreferrer">
                    <span className="archive-source-tag dataset" title={`Dataset: ${source}`}>
                      Dataset · {source}
                    </span>
                  </a>
                ))}
                {inputs.kernel_sources?.map((source) => (
                  <a key={`kernel-${source}`} href={sourceLink('kernel', source)} target="_blank" rel="noreferrer">
                    <span className="archive-source-tag kernel" title={`Kernel: ${source}`}>
                      Kernel · {source}
                    </span>
                  </a>
                ))}
                {inputs.competition_sources?.map((source) => (
                  <a key={`competition-${source}`} href={sourceLink('competition', source)} target="_blank" rel="noreferrer">
                    <span className="archive-source-tag competition" title={`Competition: ${source}`}>
                      Competition · {source}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {metadata && (
            <section className="detail-section">
              <h3 className="detail-section-title">运行元数据</h3>
              <div className="archive-detail-grid is-compact">
                <DetailField label="语言">
                  <span className="archive-detail-text">{normalizeEnumLabel(metadata.language, 'language')}</span>
                </DetailField>
                <DetailField label="类型">
                  <span className="archive-detail-text">{normalizeEnumLabel(metadata.kernelType, 'kernel')}</span>
                </DetailField>
                <DetailField label="GPU">
                  {gpuEnabled === true ? (
                    <span className="archive-soft-tag tag-success">
                      已启用{machineShape ? ` · ${machineShape}` : ''}
                    </span>
                  ) : gpuEnabled === false ? (
                    <span className="archive-soft-tag tag-neutral">
                      未启用{machineShape ? ` · ${machineShape}` : ''}
                    </span>
                  ) : (
                    <span className="archive-soft-tag tag-neutral">未记录</span>
                  )}
                </DetailField>
                <DetailField label="Internet">
                  {internetEnabled === true ? (
                    <span className="archive-soft-tag tag-success">已启用</span>
                  ) : internetEnabled === false ? (
                    <span className="archive-soft-tag tag-neutral">未启用</span>
                  ) : (
                    <span className="archive-soft-tag tag-neutral">未记录</span>
                  )}
                </DetailField>
              </div>
            </section>
          )}

          <section className="detail-section">
            <h3 className="detail-section-title">归档文件 ({detailFiles.length})</h3>
            
            {/* Desktop Table */}
            <div className="archive-detail-files-desktop">
              <Table<ArchiveFile>
                dataSource={detailFiles}
                rowKey="name"
                size="small"
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                columns={[
                  {
                    title: '文件',
                    dataIndex: 'name',
                    ellipsis: true,
                    render: (value) => <span className="archive-file-name-mono">{value}</span>,
                  },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 100,
                    render: (value) => <span className="archive-file-type-pill">{value}</span>,
                  },
                  {
                    title: '大小',
                    dataIndex: 'size_bytes',
                    width: 100,
                    align: 'right',
                    render: (size) => <span className="archive-file-size-val">{formatBytes(size)}</span>,
                  },
                ]}
              />
            </div>

            {/* Mobile Compact File List */}
            <div className="archive-detail-files-mobile">
              {detailFiles.map((file) => (
                <div key={file.name} className="archive-mobile-file-row">
                  <div className="archive-mobile-file-name" title={file.name}>
                    {file.name}
                  </div>
                  <div className="archive-mobile-file-meta">
                    <span className="archive-mobile-file-type">{file.type}</span>
                    <span className="archive-mobile-file-size">{formatBytes(file.size_bytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  );
};

export default ArchiveDetailModal;
