import type { SyncQueue, SyncFailed } from "@/domain";

import { useEffect } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@heroui/table";
import { Chip } from "@heroui/chip";
import { useState } from "react";

import { useSyncStore } from "@/stores/syncStore";
import { getAll, del } from "@/lib/db";

export default function SincronizacionPage() {
  const { isOnline, isSyncing, forceSync, updateStats } = useSyncStore();
  const [queueItems, setQueueItems] = useState<SyncQueue[]>([]);
  const [failedItems, setFailedItems] = useState<SyncFailed[]>([]);

  const loadData = async () => {
    const queue = await getAll<SyncQueue>("sync_queue");
    const failed = await getAll<SyncFailed>("sync_failed");

    setQueueItems(queue.filter((item) => !item.sincronizado));
    setFailedItems(failed);
    await updateStats();
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleForceSync = async () => {
    await forceSync();
    await loadData();
  };

  const handleRetry = async (item: SyncFailed) => {
    // Mover de nuevo a sync_queue
    const queueItem: SyncQueue = {
      id: `retry_${Date.now()}_${item.registroId}`,
      tabla: item.tabla,
      operacion: item.operacion,
      registroId: item.registroId,
      datos: item.datos,
      intentos: 0,
      timestamp: Date.now(),
      sincronizado: false,
    };

    await import("@/lib/db").then(({ put }) => put("sync_queue", queueItem));
    await del("sync_failed", item.id);
    await loadData();
  };

  const handleDelete = async (id: string) => {
    await del("sync_failed", id);
    await loadData();
  };

  return (
    <section className="flex flex-col gap-4 py-8 md:py-10">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Sincronización</h1>
        <Button
          color="primary"
          isDisabled={!isOnline}
          isLoading={isSyncing}
          onPress={handleForceSync}
        >
          Forzar sincronización
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-bold">Estado</h2>
        </CardHeader>
        <CardBody className="gap-2">
          <div className="flex gap-2 items-center">
            <span>Conexión:</span>
            <Chip color={isOnline ? "success" : "danger"} variant="flat">
              {isOnline ? "En línea" : "Sin conexión"}
            </Chip>
          </div>
          <div className="flex gap-2 items-center">
            <span>Estado:</span>
            <Chip color={isSyncing ? "primary" : "default"} variant="flat">
              {isSyncing ? "Sincronizando..." : "Inactivo"}
            </Chip>
          </div>
          <div className="flex gap-2 items-center">
            <span>Pendientes:</span>
            <Chip
              color={queueItems.length > 0 ? "primary" : "success"}
              variant="flat"
            >
              {queueItems.length}
            </Chip>
          </div>
          <div className="flex gap-2 items-center">
            <span>Fallidos:</span>
            <Chip
              color={failedItems.length > 0 ? "danger" : "success"}
              variant="flat"
            >
              {failedItems.length}
            </Chip>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-bold">Cola de Sincronización</h2>
        </CardHeader>
        <CardBody>
          {queueItems.length === 0 ? (
            <p className="text-center text-default-500 py-4">
              No hay elementos pendientes de sincronización
            </p>
          ) : (
            <Table aria-label="Cola de sincronización">
              <TableHeader>
                <TableColumn>TABLA</TableColumn>
                <TableColumn>OPERACIÓN</TableColumn>
                <TableColumn>REGISTRO ID</TableColumn>
                <TableColumn>INTENTOS</TableColumn>
                <TableColumn>FECHA</TableColumn>
              </TableHeader>
              <TableBody>
                {queueItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.tabla}</TableCell>
                    <TableCell>
                      <Chip
                        color={
                          item.operacion === "CREATE"
                            ? "success"
                            : item.operacion === "UPDATE"
                              ? "primary"
                              : "danger"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {item.operacion}
                      </Chip>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.registroId}
                    </TableCell>
                    <TableCell>{item.intentos}</TableCell>
                    <TableCell>
                      {new Date(item.timestamp).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-bold">Sincronizaciones Fallidas</h2>
        </CardHeader>
        <CardBody>
          {failedItems.length === 0 ? (
            <p className="text-center text-default-500 py-4">
              No hay errores de sincronización
            </p>
          ) : (
            <Table aria-label="Sincronizaciones fallidas">
              <TableHeader>
                <TableColumn>TABLA</TableColumn>
                <TableColumn>OPERACIÓN</TableColumn>
                <TableColumn>REGISTRO ID</TableColumn>
                <TableColumn>ERROR</TableColumn>
                <TableColumn>ACCIONES</TableColumn>
              </TableHeader>
              <TableBody>
                {failedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.tabla}</TableCell>
                    <TableCell>
                      <Chip
                        color={
                          item.operacion === "CREATE"
                            ? "success"
                            : item.operacion === "UPDATE"
                              ? "primary"
                              : "danger"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {item.operacion}
                      </Chip>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.registroId}
                    </TableCell>
                    <TableCell className="text-danger text-sm">
                      {item.error}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          color="primary"
                          size="sm"
                          onPress={() => handleRetry(item)}
                        >
                          Reintentar
                        </Button>
                        <Button
                          color="danger"
                          size="sm"
                          variant="light"
                          onPress={() => handleDelete(item.id)}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
