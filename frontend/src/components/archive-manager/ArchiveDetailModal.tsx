import React from 'react';
import {
  Alert,
  Button,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CodeOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import type { ArchiveEntry, ArchiveFile } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
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
  open: boolean;
  onClose: () => void;
  archive: ArchiveEntry | null;
  metadata: ArchiveMetadata | null;
  files: ArchiveFile[];
  loading: boolean;
  error: string | null;
  onOpenVsCode: (archive: ArchiveEntry) => void;
  onOpenFolder: (archive: ArchiveEntry) => void;
  onDownloadSource: (archive: ArchiveEntry) => void;
}

export const ArchiveDetailModal: React.FC<ArchiveDetailModalProps> = ({
  open,
  onClose,
  archive,
  metadata: detailMetadata,
  files: detailFiles,
  loading,
  error,
  onOpenVsCode,
  onOpenFolder,
  onDownloadSource,
}) => {
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
      title={(
        <DialogTitle onClose={onClose}>
          {archive ? `${archive.ref} · v${archive.version_number}` : '归档详情'}
        </DialogTitle>
      )}
      open={open}
      closable={false}
      width={880}
      onCancel={onClose}
      footer={
        <Space wrap>
          {archive && (
            <>
              <Button icon={<CodeOutlined />} onClick={() => onOpenVsCode(archive)}>在 VS Code 中打开</Button>
              <Button icon={<FolderOpenOutlined />} onClick={() => onOpenFolder(archive)}>打开目录</Button>
              <Button icon={<DownloadOutlined />} onClick={() => onDownloadSource(archive)}>下载源文件</Button>
            </>
          )}
          <Button type="primary" onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      {loading ? (
        <div style={{ display: 'grid', minHeight: 240, placeItems: 'center' }}><Spin /></div>
      ) : error ? (
        <Alert type="error" showIcon message="详情加载失败" description={error} />
      ) : archive ? (
        <>
          <div className="archive-detail-grid" aria-label="归档基础信息">
            <DetailField label="Kernel">
              <span className="copy-field">
                <a href={kaggleKernelUrl(archive.ref)} target="_blank" rel="noreferrer">{archive.ref}</a>
                <CopyButton value={archive.ref} label="复制 Kernel ref" />
              </span>
            </DetailField>
            <DetailField label="作者">
              <a
                href={kaggleAuthorUrl(
                  kaggleOwnerFromRef(archive.ref) || archive.author,
                )}
                target="_blank"
                rel="noreferrer"
              >
                @{kaggleOwnerFromRef(archive.ref) || archive.author}
              </a>
            </DetailField>
            <DetailField label="竞赛">{archive.competition || '未登记'}</DetailField>
            <DetailField label="公开分数"><span className="score-value">{formatScore(archive.public_score)}</span></DetailField>
            <DetailField label="归档时间">{formatDate(archive.archived_at)}</DetailField>
            <DetailField label="包含输出">{archive.include_outputs ? <Tag color="success">是</Tag> : <Tag>否</Tag>}</DetailField>
            <DetailField label="保存路径" wide>
              <span className="copy-field">
                <Text className="archive-path-value">{archive.path}</Text>
                <CopyButton value={archive.path} label="复制保存路径" />
              </span>
            </DetailField>
          </div>

          {(inputs?.dataset_sources?.length || inputs?.kernel_sources?.length || inputs?.competition_sources?.length) ? (
            <section className="detail-section">
              <h3 className="detail-section-title">输入依赖</h3>
              <div className="source-list">
                {inputs.dataset_sources?.map((source) => <a key={`dataset-${source}`} href={sourceLink('dataset', source)} target="_blank" rel="noreferrer"><Tag>Dataset · {source}</Tag></a>)}
                {inputs.kernel_sources?.map((source) => <a key={`kernel-${source}`} href={sourceLink('kernel', source)} target="_blank" rel="noreferrer"><Tag color="blue">Kernel · {source}</Tag></a>)}
                {inputs.competition_sources?.map((source) => <a key={`competition-${source}`} href={sourceLink('competition', source)} target="_blank" rel="noreferrer"><Tag color="green">Competition · {source}</Tag></a>)}
              </div>
            </section>
          ) : null}

          {metadata && (
            <section className="detail-section">
              <h3 className="detail-section-title">运行元数据</h3>
              <div className="archive-detail-grid is-compact">
                <DetailField label="语言">{normalizeEnumLabel(metadata.language, 'language')}</DetailField>
                <DetailField label="类型">{normalizeEnumLabel(metadata.kernelType, 'kernel')}</DetailField>
                <DetailField label="GPU">{gpuEnabled === true ? <Tag color="success">已启用{machineShape ? ` · ${machineShape}` : ''}</Tag> : gpuEnabled === false ? <Tag>未启用{machineShape ? ` · ${machineShape}` : ''}</Tag> : <Tag>未记录</Tag>}</DetailField>
                <DetailField label="Internet">{internetEnabled === true ? <Tag color="success">已启用</Tag> : internetEnabled === false ? <Tag>未启用</Tag> : <Tag>未记录</Tag>}</DetailField>
              </div>
            </section>
          )}

          <section className="detail-section">
            <h3 className="detail-section-title">归档文件</h3>
            <Table<ArchiveFile>
              dataSource={detailFiles}
              rowKey="name"
              size="small"
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              columns={[
                { title: '文件', dataIndex: 'name', ellipsis: true, render: (value) => <span className="mono-text">{value}</span> },
                { title: '类型', dataIndex: 'type', width: 100, responsive: ['sm'], render: (value) => <Tag>{value}</Tag> },
                { title: '大小', dataIndex: 'size_bytes', width: 90, render: formatBytes },
              ]}
            />
          </section>
        </>
      ) : null}
    </Modal>
  );
};

export default ArchiveDetailModal;
