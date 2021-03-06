import React from "react";
import { t } from "c-3po";
import { Box, Flex } from "grid-styled";

import { entityListLoader } from "metabase/entities/containers/EntityListLoader";

import AdminHeader from "metabase/components/AdminHeader";
import Icon, { IconWrapper } from "metabase/components/Icon";
import Link from "metabase/components/Link";
import Tooltip from "metabase/components/Tooltip";

@entityListLoader({
  entityType: "tasks",
  pageSize: 50,
})
class TasksApp extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      offset: this.props.entityQuery.offset,
    };
  }
  render() {
    const {
      tasks,
      page,
      pageSize,
      onNextPage,
      onPreviousPage,
      children,
    } = this.props;
    return (
      <Box p={3}>
        <Flex align="center">
          <Flex align="center">
            <AdminHeader title={t`Troubleshooting logs`} />
            <Tooltip
              tooltip={t`Trying to get to the bottom of something? This section shows logs of Foundry's background tasks, which can help shed light on what's going on.`}
            >
              <Icon
                name="info"
                ml={1}
                style={{ marginTop: 5 }}
                className="text-brand-hover cursor-pointer text-medium"
              />
            </Tooltip>
          </Flex>
          <Flex align="center" ml="auto">
            <span className="text-bold mr1">
              {page * pageSize + 1} - {page * pageSize + tasks.length}
            </span>
            <IconWrapper onClick={onPreviousPage} disabled={!onPreviousPage}>
              <Icon name="chevronleft" />
            </IconWrapper>
            <IconWrapper small onClick={onNextPage} disabled={!onNextPage}>
              <Icon name="chevronright" />
            </IconWrapper>
          </Flex>
        </Flex>

        <table className="ContentTable mt2">
          <thead>
            <th>{t`Task`}</th>
            <th>{t`DB ID`}</th>
            <th>{t`Started at`}</th>
            <th>{t`Ended at`}</th>
            <th>{t`Duration (ms)`}</th>
            <th>{t`Details`}</th>
          </thead>
          <tbody>
            {tasks.map(task => (
              <tr key={task.id}>
                <td className="text-bold">{task.task}</td>
                <td>{task.db_id}</td>
                <td>{task.started_at}</td>
                <td>{task.ended_at}</td>
                <td>{task.duration}</td>
                <td>
                  <Link
                    className="link text-bold"
                    to={`/admin/troubleshooting/tasks/${task.id}`}
                  >{t`View`}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {
          // render 'children' so that the invididual task modals show up
          children
        }
      </Box>
    );
  }
}

export default TasksApp;
